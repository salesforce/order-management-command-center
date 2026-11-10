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
// Operations Console read-only Service Console queue.
import { RANGES, OPEN_PE, YEAR } from '../../shared/data/om-reads.js';
import { idList } from '../../shared/data/om-core-util.js';

export function queueReads(k) {
  const { soql, describe, pick, safe, caseOrderRel } = k;
  // ---------- service tab ----------
  // A shared team queue (open cases, plus open exceptions grouped by order and category) and a customer 360 for service agents.
  // Everything is a GET through soql()/describe(), so it batches into /composite like the rest. Nothing here writes.
  const PRIORITY = { Critical: 0, High: 1, Medium: 2, Low: 3 };

  // Almost everything open is owned by Automated Process or a queue; neither counts as "assigned".
  const ownerOf = (o) => ({ name: o?.Name ?? null, person: !!o?.Name && o.Type !== 'Queue' && o.Name !== 'Automated Process' });
  const byPriority = (a, b) => (PRIORITY[a.priority] ?? PRIORITY.Low) - (PRIORITY[b.priority] ?? PRIORITY.Low) || String(b.at || '').localeCompare(String(a.at || ''));

  // Exceptions repeat by the thousand (one order has 8,000+ "Transfer Reservation" rows), so they're counted with GROUP BY.
  // Priority is in the GROUP BY (a picklist is groupable, not aggregatable), so a group can come back as several rows that are merged per order|category.
  // A group with no known priority sorts as Low, by date. The newest-row sample only supplies id, number, message and owner.
  async function serviceQueue(rangeKey) {
    const key = rangeKey === 'all' || Object.hasOwn(RANGES, rangeKey) ? rangeKey : '90d';
    const when = ` AND CreatedDate = ${key === 'all' ? YEAR : RANGES[key]}`; // 'all' reads the last 12 months
    const [peD, csD, rel] = await Promise.all([describe('ProcessException'), describe('Case'), caseOrderRel()]);
    const hasPE = !!peD?.fields.has('OrderSummaryId') && peD.fields.has('Category') && peD.rels.has('OrderSummary'), hasCS = !!csD?.fields.has('IsClosed');
    // Exceptions already attached to a case show on that case's row instead of their own.
    const loose = peD?.fields.has('CaseId') ? ' AND CaseId = null' : '';
    const [peF, csF] = await Promise.all([
      pick('ProcessException', ['Id', 'ProcessExceptionNumber', 'OrderSummaryId', 'Category', 'Message', 'Priority', 'Severity', 'CreatedDate', 'Owner.Name', 'Owner.Type']),
      pick('Case', ['Id', 'CaseNumber', 'Subject', 'Type', 'Priority', 'Status', 'CreatedDate', 'Owner.Name', 'Owner.Type', 'AccountId', 'Account.Name', ...(rel ? [`${rel}.Id`, `${rel}.OrderNumber`] : [])])]);
    const G = 300, C = 200, GQ = 2000, hasPri = peF.includes('Priority');
    const [groups, cases] = await Promise.all([
      hasPE ? safe(() => soql(`SELECT OrderSummaryId o, OrderSummary.OrderNumber n, OrderSummary.AccountId a, OrderSummary.Account.Name an, Category k, ${hasPri ? 'Priority p, ' : ''}COUNT(Id) c, MAX(CreatedDate) l FROM ProcessException WHERE ${OPEN_PE}${when}${loose} GROUP BY OrderSummaryId, OrderSummary.OrderNumber, OrderSummary.AccountId, OrderSummary.Account.Name, Category${hasPri ? ', Priority' : ''} ORDER BY MAX(CreatedDate) DESC LIMIT ${GQ}`)) : { ok: true, data: [] },
      hasCS ? safe(() => soql(`SELECT ${csF.join(', ')} FROM Case WHERE IsClosed = false${when} ORDER BY CreatedDate DESC LIMIT ${C}`)) : { ok: true, data: [] }]);
    // Merge the per-priority rows: sum the counts, keep the newest date and the highest priority.
    const merged = new Map();
    for (const g of groups.ok ? groups.data : []) {
      const m = merged.get(`${g.o}|${g.k}`);
      if (!m) { merged.set(`${g.o}|${g.k}`, { ...g }); continue; }
      m.c += g.c; if (String(g.l || '') > String(m.l || '')) m.l = g.l;
      if ((PRIORITY[g.p] ?? 9) < (PRIORITY[m.p] ?? 9)) m.p = g.p;
    }
    const all = [...merged.values()].sort((a, b) => String(b.l || '').localeCompare(String(a.l || '')));
    const gs = all.slice(0, G), cs = cases.ok ? cases.data : [];
    const gTrunc = all.length > G || (groups.ok && groups.data.length >= GQ);
    const orderIds = idList(gs.map((g) => g.o)), caseIds = idList(cs.map((c) => c.Id));
    const [newest, linked] = await Promise.all([
      orderIds ? soql(`SELECT ${peF.join(', ')} FROM ProcessException WHERE OrderSummaryId IN (${orderIds}) AND ${OPEN_PE}${when}${loose} ORDER BY CreatedDate DESC LIMIT 2000`).catch(() => []) : [],
      caseIds && loose ? soql(`SELECT CaseId, Category, COUNT(Id) c FROM ProcessException WHERE CaseId IN (${caseIds}) AND ${OPEN_PE} GROUP BY CaseId, Category`).catch(() => []) : []]);
    const first = new Map();
    for (const r of newest) { const k = `${r.OrderSummaryId}|${r.Category}`; if (!first.has(k)) first.set(k, r); }
    const items = [
      ...cs.map((c) => ({ kind: 'case', key: c.Id, id: c.Id, number: c.CaseNumber, subject: c.Subject ?? null, category: c.Type ?? null, priority: c.Priority ?? null, severity: null, count: 1, at: c.CreatedDate,
        owner: ownerOf(c.Owner), order: rel && c[rel]?.Id ? { id: c[rel].Id, number: c[rel].OrderNumber ?? null } : null, account: c.AccountId ? { id: c.AccountId, name: c.Account?.Name ?? null } : null,
        fromExceptions: linked.filter((x) => x.CaseId === c.Id).map((x) => ({ category: x.Category, count: x.c })) })),
      ...gs.map((g) => {
        const r = first.get(`${g.o}|${g.k}`);
        return { kind: 'exception', key: `${g.o}|${g.k}`, id: r?.Id ?? null, number: r?.ProcessExceptionNumber ?? null, subject: r?.Message ?? null, category: g.k, priority: g.p ?? r?.Priority ?? null, severity: r?.Severity ?? null,
          count: g.c, at: g.l, owner: ownerOf(r?.Owner), order: g.o ? { id: g.o, number: g.n ?? null } : null, account: g.a ? { id: g.a, name: g.an ?? null } : null, fromExceptions: [] };
      })].sort(byPriority);
    const errors = [...(groups.ok ? [] : [`Exceptions: ${groups.error}`]), ...(cases.ok ? [] : [`Cases: ${cases.error}`])];
    return { range: key, items, truncated: gTrunc || cs.length >= C, objects: { ProcessException: hasPE, Case: hasCS }, errors, at: new Date().toISOString() };
  }

  return { serviceQueue, routes: [['/api/service/queue', (m, q) => serviceQueue(q('range'))]] };
}
