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
// The Limits view's reference section as HTML text (its page is in console-limits-view.js): the limits closest to full, the
// read-only access checks, and the table of every limit. Pure: rows in, markup out, so a test can read it without a page.
import { esc } from './console-kit.js';
import { limAmt } from './console-limits.js';

// A read-only check's mark, and what it says beside the name; any other state shows ✕ and the check's own note.
const ACCESS_MARK = { ok: '✓', empty: '–' };
const ACCESS_SAYS = { ok: 'readable', empty: 'readable, no rows' };

// The ten limits closest to full (rows from limRows), each with a bar.
export const limTopHtml = (rows) => rows.filter((r) => r.f != null).sort((a, b) => b.f - a.f).slice(0, 10)
  .map((r) => `<div class="ltr lv-${r.level}"><span class="n" title="${esc(r.group)}">${esc(r.name)}</span><div class="bar"><i style="width:${Math.min(100, r.f * 100).toFixed(1)}%"></i></div><span class="val">${Math.round(r.f * 100)}%</span></div>`).join('') || '<div class="empty">No limits reported.</div>';

// What each read-only check could read, then the line that says nothing here changes data.
export const limAccessHtml = (acc) => acc.map((x) => `<div class="lacc ${x.state}" title="${esc(x.note)}"><span>${ACCESS_MARK[x.state] || '✕'}</span> ${esc(x.name)}<span class="muted"> ${ACCESS_SAYS[x.state] || esc(x.note)}</span></div>`).join('')
  + (acc.length ? '<div class="lsub">Read-only checks: nothing here changes data.</div>' : '');

// Why the Entitlements rows are missing, as a table row ('' when they're readable).
export function limEntRow(acc) {
  const noEnt = acc.find((x) => x.name === 'Entitlements' && x.state !== 'ok');
  if (!noEnt) return '';
  return `<tr><td colspan="5" class="muted">Entitlement rows are missing: ${esc(noEnt.state === 'empty' ? 'this org has none' : noEnt.note || 'not readable by your user')}.</td></tr>`;
}

const limRowHtml = (r) => `<tr style="cursor:default" class="lv-${r.level}"><td class="muted">${esc(r.group)}</td><td>${esc(r.name)}</td><td class="num">${esc(r.used == null ? '—' : limAmt(r.used, r.unit))}</td><td class="num">${esc(limAmt(r.max, r.unit))}</td><td class="num lpc">${r.f == null ? '—' : Math.round(r.f * 100) + '%'}</td></tr>`;

// Every limit, narrowed by `search` (lower case) on its name or group.
export function limAllHtml(rows, acc, search) {
  const shown = rows.filter((r) => !search || `${r.name} ${r.group}`.toLowerCase().includes(search));
  return `<table class="score"><thead><tr><th>Type</th><th>Name</th><th class="num">Used</th><th class="num">Limit</th><th class="num">%</th></tr></thead><tbody>${limEntRow(acc)}${shown.map(limRowHtml).join('') || '<tr><td colspan="5" class="muted">Nothing matches.</td></tr>'}</tbody></table>`;
}
