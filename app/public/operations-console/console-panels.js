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
// The dashboard's panels as the agent sees them: each panel registers its title, source object and rows (panel()), and
// agentPanelFacts() turns the asked panel, or the whole tab, into the few lines a question carries. Only panels marked for the
// agent are read, and their Id columns are left out.
import { esc } from './console-kit.js';

// Pass AGENT as panel()'s last argument to share the panel's rows with the agent. Review the csv columns first: only
// counts, amounts and product, location, carrier or category names; never a customer name, email, phone or address.
export const AGENT = true;
export const csvStore = {};
export const askStore = {};
export function panel(id, title, src, body, csv, cls = '', agent = false) {
  if (csv) csvStore[id] = csv; else delete csvStore[id];
  askStore[id] = { panel: String(title).replace(/<[^>]*>/g, ''), object: src, agent: agent === true };
  return `<section class="zone ${cls}"><h2>${title} <span class="src">${esc(src)}</span><span class="right"><button class="linkbtn" data-ask="${id}" title="Ask the agent about this panel">Ask</button>${csv ? `<button class="linkbtn" data-csv="${id}" title="Download this panel as CSV">CSV</button>` : ''}</span></h2><div class="dbody" id="${id}">${body}</div></section>`;
}
export const agentRows = (id) => (askStore[id]?.agent === true && csvStore[id]?.rows?.length ? csvStore[id] : null);
// The asked panel's first rows as "col value" pairs; with none asked, one line per panel on the tab, top rows first.
export function agentPanelFacts(ids, askedId) {
  const facts = [];
  if (askedId) {
    const c = agentRows(askedId);
    if (c) c.rows.slice(0, 8).forEach((r) => facts.push(`${askStore[askedId].panel}: ${c.cols.map((k, i) => `${k} ${r[i] ?? '—'}`).join(', ')}`));
    return facts;
  }
  for (const id of ids) {
    const c = agentRows(id);
    if (!c) continue;
    // Id columns would eat the line, and rates arrive unrounded.
    const keep = c.cols.map((k, i) => (/_id$/.test(k) ? -1 : i)).filter((i) => i >= 0), cell = (v) => (typeof v === 'number' && !Number.isInteger(v) ? +v.toPrecision(3) : v);
    const cols = keep.map((i) => c.cols[i]);
    facts.push(`${askStore[id].panel}${cols.length > 2 ? ` (${cols.join(' ')})` : ''}: ${c.rows.slice(0, 6).map((r) => keep.map((i) => cell(r[i])).filter((v) => v != null && v !== '').join(' ')).join(' | ')}`);
  }
  return facts;
}
