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
// Salesforce Order Management Operations Console — request meter (pure; no I/O except an optional BroadcastChannel and localStorage, both injected).
// Every HTTP call the console makes is recorded here: om-platform.js (inside Salesforce), om-browser.js (hosted) and server.mjs
// (local) call record(); the Limits view subscribes. The console's tabs are separate pages on one origin, so each call is also
// broadcast on a BroadcastChannel and kept in localStorage: the Limits tab then sees the Dashboard's calls the moment they happen.
// Nothing here reads or stores query text, record names or other row data: a path is cut at '?' and only the object name of a
// SOQL query is kept.

const WINDOW_MS = 60 * 60 * 1000, CAP = 2000, STORED = 600, SECONDS = 900, MINUTES = 60, RECENT = 50;
export const KINDS = ['apex', 'batch', 'graphql', 'ui-api', 'connect', 'action'];

// Which kind of call a path is. Paths are as the platform and hosted transports see them (relative to /services/data/vXX.X, or
// the full /services/... path inside Salesforce).
export function kindOf(path) {
  const p = String(path || '');
  if (/\/apexrest\/somservice\b/.test(p)) return 'action';
  if (/\/apexrest\/somconsole\/batch\b/.test(p)) return 'batch';
  if (/\/apexrest\/somconsole\b/.test(p)) return 'apex';
  if (/\/graphql\b/.test(p)) return 'graphql';
  if (/\/commerce\//.test(p)) return 'connect';
  return 'ui-api';
}

// 'rows=120/50000;queries=4/100;cpu=35;heap=2048/6000000;api=124/100000' → { rows: 120, rowsMax: 50000, queries: 4, ... }
export function parseLimitsHeader(value) {
  if (value && typeof value === 'object') return value;
  const out = {};
  for (const part of String(value || '').split(';')) {
    const m = part.trim().match(/^([A-Za-z]\w*)=(-?\d+(?:\.\d+)?)(?:\/(-?\d+(?:\.\d+)?))?$/);
    if (!m) continue;
    out[m[1]] = Number(m[2]);
    if (m[3] !== undefined) out[`${m[1]}Max`] = Number(m[3]);
  }
  return Object.keys(out).length ? out : null;
}

// Path without its query string; a SOQL query keeps only the object after FROM.
function cleanPath(raw) {
  const s = String(raw || ''), i = s.indexOf('?');
  const path = (i < 0 ? s : s.slice(0, i)).slice(0, 160);
  let object = null;
  if (i >= 0) {
    try { const q = new URLSearchParams(s.slice(i + 1)).get('q'); object = q && q.match(/\bFROM\s+(\w+)/i)?.[1] || null; } catch { /* odd query string: no object */ }
  }
  return { path, object };
}

const failed = (e) => e.status >= 400 || e.status === 0;

export function normalize(e, now = Date.now) {
  const { path, object } = cleanPath(e?.path);
  const n = {
    t: Number.isFinite(e?.t) ? e.t : now(),
    kind: KINDS.includes(e?.kind) ? e.kind : kindOf(e?.path),
    path, method: String(e?.method || 'GET').toUpperCase().slice(0, 8),
    ms: Math.max(0, Math.round(Number(e?.ms) || 0)),
    status: Number.isFinite(Number(e?.status)) ? Number(e.status) : 0,
    rows: Number.isFinite(e?.rows) ? e.rows : null,
    apex: parseLimitsHeader(e?.apex),
  };
  if (object || e?.object) n.object = object || String(e.object).slice(0, 80);
  if (e?.source) n.source = String(e.source).slice(0, 20);
  return n;
}

const keyOf = (e) => `${e.t}|${e.path}|${e.ms}|${e.source || ''}`;
const apexRows = (e) => e.apex?.rows ?? 0;
// Nearest-rank percentile of a sorted array.
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] : 0);

export function createMeter({ channel = 'som-meter', storageKey = 'som-meter', now = Date.now, storage = globalThis.localStorage, bc = globalThis.BroadcastChannel } = {}) {
  let list = [];            // entries, oldest first by arrival
  const seen = new Set();   // keys of what's in `list`
  const subs = new Set();

  const prune = () => {
    const from = now() - WINDOW_MS;
    if (list.length <= CAP && list.every((e) => e.t >= from)) return;
    list = list.filter((e) => e.t >= from).sort((a, b) => a.t - b.t).slice(-CAP);
    seen.clear();
    for (const e of list) seen.add(keyOf(e));
  };
  const persist = () => {
    try { storage?.setItem(storageKey, JSON.stringify(list.slice(-STORED))); } catch { /* storage full or blocked: the meter still works in memory */ }
  };
  const add = (e) => {
    const k = keyOf(e);
    if (seen.has(k)) return false;
    seen.add(k); list.push(e); prune();
    return true;
  };
  const notify = (e) => { for (const fn of subs) { try { fn(e); } catch { /* one bad subscriber must not stop the others */ } } };

  try { for (const e of JSON.parse(storage?.getItem(storageKey) || '[]')) add(normalize(e, now)); } catch { /* nothing stored, or unreadable */ }

  let chan = null;
  try {
    chan = bc ? new bc(channel) : null;
    chan?.unref?.(); // Node: an idle channel must not keep the process alive (browsers have no unref)
    if (chan) chan.onmessage = (m) => {
      if (!m?.data || typeof m.data !== 'object') return;
      const e = { ...normalize(m.data, now), remote: true };
      if (add(e)) { persist(); notify(e); }
    };
  } catch { chan = null; }

  return {
    record(entry) {
      const e = normalize(entry, now);
      if (!add(e)) return e;
      persist();
      try { chan?.postMessage(e); } catch { /* channel closed */ }
      notify(e);
      return e;
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    // Entries newer than `since` (ms), oldest first. server.mjs serves these at /api/meter.
    entries(since = 0) { prune(); return list.filter((e) => e.t > since).sort((a, b) => a.t - b.t); },
    snapshot() {
      prune();
      const t0 = now(), all = [...list].sort((a, b) => a.t - b.t);
      const perSecond = Array.from({ length: SECONDS }, (_, i) => ({ t: Math.floor(t0 / 1000) * 1000 - (SECONDS - 1 - i) * 1000, n: 0, errors: 0, ms: 0, apexRows: 0 }));
      const perMinute = Array.from({ length: MINUTES }, (_, i) => ({ t: Math.floor(t0 / 60000) * 60000 - (MINUTES - 1 - i) * 60000, n: 0, errors: 0, ms: 0, apexRows: 0 }));
      const bump = (b, e) => { b.n++; b.ms += e.ms; b.apexRows += apexRows(e); if (failed(e)) b.errors++; };
      const byKind = {}, bySource = {};
      for (const e of all) {
        const s = perSecond[Math.floor((e.t - perSecond[0].t) / 1000)], m = perMinute[Math.floor((e.t - perMinute[0].t) / 60000)];
        if (s) bump(s, e);
        if (m) bump(m, e);
        const k = (byKind[e.kind] ||= { n: 0, errors: 0, ms: 0 });
        k.n++; k.ms += e.ms; if (failed(e)) k.errors++;
        if (e.source) bySource[e.source] = (bySource[e.source] || 0) + 1;
      }
      const ms = all.map((e) => e.ms).sort((a, b) => a - b);
      let heaviest = null, slowest = null;
      for (const e of all) {
        if (!slowest || e.ms > slowest.ms) slowest = e;
        if (apexRows(e) > 0 && (!heaviest || apexRows(e) > apexRows(heaviest))) heaviest = e;
      }
      return {
        at: t0, entries: all.slice(-RECENT).reverse(), perSecond, perMinute, byKind, bySource,
        totals: { n: all.length, errors: all.filter(failed).length, p50: pct(ms, 0.5), p95: pct(ms, 0.95), peakRows: Math.max(0, ...all.map(apexRows)) },
        heaviest, slowest,
      };
    },
    reset() {
      list = []; seen.clear();
      try { storage?.removeItem(storageKey); } catch { /* nothing to clear */ }
    },
    close() { try { chan?.close(); } catch { /* already closed */ } },
  };
}
