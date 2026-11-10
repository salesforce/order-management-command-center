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
// The live briefing: Salesforce Order Management Operations Console's `briefing` read (om-reads.js), run by the same createCore() as every other path, through
// the viewer's own Salesforce connector on claude.ai. tools/build-live-artifact.mjs builds it into one artifact page.
import { createCore } from './om-command-core.js';
import { CONFIG } from './om-config.js';
import { CONNECTOR, connectorRequest, probe } from './artifact-connector.js';
// The one platform-specific piece, wired in artifact-call.js (--local builds artifact-call-local.js in its place).
import { callConnector, connectHelp } from './artifact-call.js';

const request = connectorRequest(callConnector, { blocked: CONFIG.blocked });
// apiVersion() null: every GET goes out on its own, since the connector has no /composite (a POST).
const core = createCore({ request, instanceUrl: request.instanceUrl, apiVersion: () => null });

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => (n == null ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }));
const money = (n) => (n == null ? '' : Number(n).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 }));
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };
const ago = (iso) => {
  const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  return !iso || Number.isNaN(m) ? '' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const sum = (rows, k = 'c') => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);

// A query's outcome as the read reports it: rows, or why there are none.
const why = (r) => (!r ? 'Not read' : r.skipped ? `Not in this org (${r.skipped})` : r.error ? `Couldn't read: ${r.error}` : '');

function tile(label, r, pick) {
  const note = why(r);
  if (note) return `<div class="tile off"><div class="k">${esc(label)}</div><div class="note">${esc(note)}</div></div>`;
  const { big, sub, split } = pick(r.rows);
  return `<div class="tile"><div class="k">${esc(label)}</div><div class="v">${esc(big)}</div>`
    + `${sub ? `<div class="sub">${esc(sub)}</div>` : ''}${split ? `<div class="split">${split.map(([k, n]) => `<span>${esc(k)} <b>${esc(num(n))}</b></span>`).join('')}</div>` : ''}`
    + `${r.capped ? '<div class="note">At Salesforce\'s row cap</div>' : ''}</div>`;
}
// Grouped by day (d): today's figure, with yesterday's under it.
const byDay = (v) => (rows) => {
  const t = rows.filter((r) => r.d === day(0)), y = rows.filter((r) => r.d === day(-1));
  const val = (rs) => (v ? ` · ${money(sum(rs, 'v'))}` : '');
  return { big: `${num(sum(t))}${val(t)}`, sub: `Yesterday ${num(sum(y))}${val(y)}` };
};
const byKey = (k) => (rows) => {
  const g = {};
  for (const r of rows) g[r[k] ?? '(blank)'] = (g[r[k] ?? '(blank)'] || 0) + (Number(r.c) || 0);
  return { big: num(sum(rows)), split: Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 4) };
};

function table(id, r, cols) {
  const el = $(`#${id} .body`), note = why(r);
  if (note) { el.innerHTML = `<p class="note">${esc(note)}</p>`; return; }
  if (!r.rows.length) { el.innerHTML = '<p class="note">Nothing here right now.</p>'; return; }
  el.innerHTML = `<table><thead><tr>${cols.map(([h]) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`
    + r.rows.map((row) => `<tr>${cols.map(([, f]) => `<td>${esc(f(row))}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
}

function render({ results: x }) {
  $('#today').innerHTML = [
    tile('Orders', x.orders, byDay(true)), tile('Fulfillment orders', x.fulfillment, byDay(false)),
    tile('Shipments', x.shipments, byDay(false)), tile('Returns', x.returns, byDay(true)),
    tile('New exceptions', x.newExceptions, byDay(false)), tile('New cases', x.newCases, byDay(false)),
  ].join('');
  $('#open').innerHTML = [
    tile('Open exceptions', x.openExceptions, byKey('sev')), tile('Open cases', x.openCases, byKey('p')),
    tile('Stuck fulfillment orders', x.stuckTotal, (rows) => ({ big: num(rows[0]?.c ?? 0), sub: 'No change in 2 days' })),
  ].join('');
  table('stuckByLocation', x.stuckByLocation, [['Location', (r) => r.loc ?? r.l], ['Stuck', (r) => num(r.c)]]);
  const fo = [['Fulfillment order', (r) => r.FulfillmentOrderNumber], ['Status', (r) => r.Status], ['From', (r) => r.FulfilledFromLocation?.Name],
    ['Order', (r) => r.OrderSummary?.OrderNumber], ['Quiet for', (r) => ago(r.LastModifiedDate)]];
  table('stuck', x.stuck, fo);
  table('newlyStuck', x.newlyStuck, fo);
  table('latestExceptions', x.latestExceptions, [['Exception', (r) => r.ProcessExceptionNumber], ['Category', (r) => r.Category], ['Severity', (r) => r.Severity],
    ['Status', (r) => r.Status], ['Order', (r) => r.OrderSummary?.OrderNumber], ['Age', (r) => ago(r.CreatedDate)]]);
}

function state(text, kind) { const s = $('#state'); s.textContent = text; s.dataset.kind = kind; }
function needs(e) {
  $('#needs').hidden = false; $('#live').hidden = true;
  if (connectHelp) $('#needs .how').textContent = connectHelp;
  $('#needs .why').textContent = e?.notWired ? e.message : e?.code === 401 ? `Your ${CONNECTOR} sign-in has expired: reconnect it, then reload.` : e?.message || '';
  state('Not connected', 'off');
}

let busy = false;
async function load() {
  if (busy) return;
  busy = true; $('#refresh').disabled = true; state('Loading…', 'wait');
  try {
    const p = await probe(request);
    if (!p.ok) return needs(p.error);
    render(await core.route('/api/read/briefing'));
    $('#needs').hidden = true; $('#live').hidden = false;
    state('Live', 'on'); $('#at').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) { needs(e); } finally { busy = false; $('#refresh').disabled = false; }
}

$('#refresh').addEventListener('click', load);
load();
