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
// The Dashboard's reads: Today, MTD, QTD, YTD, 6 months, 1 year or All time, each against the period before cut to the same
// elapsed time, and the Products tab's rates. Part of the read model (om-core.js); nothing here writes.
import { ID_RE, OPEN_PE, OPEN_FO, FO_DONE, FO_FULFILLED, NOT_CANCELED } from '../../shared/data/om-reads.js';
import { scopeOf, pre } from '../../shared/data/om-core-util.js';

// Products tab: cancel and return rates per product (units ÷ units ordered). A product needs at least `floor` units ordered,
// 5 or 1% of all units in the rows, whichever is more, so a single cancelled one-off can't top the list at 100%.
export const PROD_ROWS = 200;
export const PROD_FLOOR = 5;
export function productRates(rows) {
  const units = rows.reduce((s, r) => s + (r.qo || 0), 0), floor = Math.max(PROD_FLOOR, Math.ceil(units * 0.01));
  const by = (k) => !rows.length || rows.some((r) => r[k] != null) ? rows.filter((r) => r.qo >= floor && r[k] > 0).map((r) => ({ id: r.id, key: r.key, n: r[k] / r.qo, units: r[k], ordered: r.qo }))
    .sort((a, b) => b.n - a.n || b.ordered - a.ordered).slice(0, 8) : null;
  return { floor, cancelRate: by('qc'), returnRate: by('qr') };
}

export function dashboardReads(k) {
  const { soql, has, pick, safe, scoper } = k;
  // ---------- dashboard read model (Today / MTD / QTD / YTD / 6 months / 1 year / All time) ----------
  // Each period is compared with the prior period cut to the same elapsed time, so "MTD vs last month" is like for like.
  const PERIODS = ['today', 'mtd', 'qtd', 'ytd', '6m', '1y', 'all'];
  const lit = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z');
  function periodWindow(key) {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    const start = { today: new Date(y, m, now.getDate()), mtd: new Date(y, m, 1), qtd: new Date(y, m - (m % 3), 1), ytd: new Date(y, 0, 1), '6m': new Date(y, m - 6, now.getDate()), '1y': new Date(y - 1, m, now.getDate()), all: null }[key];
    if (!start) return { from: null, to: now, prevFrom: null, prevTo: null, grain: 'month' };
    const prevStart = { today: new Date(y, m, now.getDate() - 1), mtd: new Date(y, m - 1, 1), qtd: new Date(y, m - (m % 3) - 3, 1), ytd: new Date(y - 1, 0, 1), '6m': new Date(y, m - 12, now.getDate()), '1y': new Date(y - 2, m, now.getDate()) }[key];
    const prevTo = new Date(Math.min(prevStart.getTime() + (now - start), start.getTime()));
    return { from: start, to: now, prevFrom: prevStart, prevTo, grain: key === 'today' ? 'hour' : key === 'mtd' || key === 'qtd' ? 'day' : 'month' };
  }
  const within = (field, a, b) => [a && `${field} >= ${lit(a)}`, b && `${field} <= ${lit(b)}`].filter(Boolean).join(' AND ') || `${field} != null`;
  const bucket = (field, grain) => grain === 'hour' ? [`HOUR_IN_DAY(convertTimezone(${field}))`] : grain === 'day' ? [`DAY_ONLY(convertTimezone(${field}))`] : [`CALENDAR_YEAR(convertTimezone(${field}))`, `CALENDAR_MONTH(convertTimezone(${field}))`];
  const bucketKey = (r, grain) => grain === 'month' ? `${r.expr0}-${String(r.expr1).padStart(2, '0')}` : String(r.expr0);

  // `scope` is the Store and Sales channel filters ({ store, channel }, scopeOf()): each query keeps the orders of that store and
  // channel, through its object's path to OrderSummary (sc.and()); a panel whose object has none fails with UNSCOPED.
  async function dashboardData(periodKey, scope) {
    const key = PERIODS.includes(periodKey) ? periodKey : 'mtd';
    const w = periodWindow(key), grain = w.grain;
    // The filters' describes and the objects' run side by side (both are schema reads, cached once read).
    const [sc, [hasOS, hasFO, hasPE, hasRO, hasROLI, hasCM, hasOIS, hasOISC, hasPA, hasPAY, hasINV, hasREF, hasCASE, hasSH, hasLGA]] = await Promise.all([scoper(scope), Promise.all(
      ['OrderSummary', 'FulfillmentOrder', 'ProcessException', 'ReturnOrder', 'ReturnOrderLineItem', 'CreditMemo', 'OrderItemSummary', 'OrderItemSummaryChange',
        'PaymentAuthorization', 'Payment', 'Invoice', 'Refund', 'Case', 'Shipment', 'LocationGroupAssignment'].map(has))]), A = sc.and;
    const sources = [];
    // Every query the dashboard runs is recorded so the Data map shows exactly where each number comes from.
    const q = (panel, object, text) => { sources.push({ panel, object, soql: text }); return soql(text); };
    const cur = (f) => within(f, w.from, w.to), prev = (f) => within(f, w.prevFrom, w.prevTo);
    const one = async (panel, object, sel, field, extra = '') => {
      const where = (fn) => `${fn(field)}${pre(' AND ', extra)}${A(object)}`;
      const [a, b] = await Promise.all([q(panel, object, `SELECT ${sel} FROM ${object} WHERE ${where(cur)}`), w.prevFrom ? q(panel, object, `SELECT ${sel} FROM ${object} WHERE ${where(prev)}`) : null]);
      return { cur: a[0], prev: b?.[0] ?? null };
    };
    const series = async (panel, object, field, extra = '') => {
      const b = bucket(field, grain);
      const rows = await q(panel, object, `SELECT ${b.join(', ')}, COUNT(Id) c FROM ${object} WHERE ${cur(field)}${pre(' AND ', extra)}${A(object)} GROUP BY ${b.join(', ')}`);
      return rows.map((r) => ({ key: bucketKey(r, grain), n: r.c }));
    };
    const group = async (panel, object, dim, field, extra = '', measure = 'COUNT(Id)', limit = 12) =>
      (await q(panel, object, `SELECT ${dim} s, ${measure} c FROM ${object} WHERE ${cur(field)}${pre(' AND ', extra)}${A(object)} GROUP BY ${dim} ORDER BY ${measure} DESC LIMIT ${limit}`)).map((r) => ({ key: r.s ?? '(blank)', n: r.c ?? 0 }));

    const tiles = safe(async () => {
      const [o, r, e, cm, fo] = await Promise.all([
        hasOS ? one('Orders · Order value', 'OrderSummary', 'COUNT(Id) c, SUM(GrandTotalAmount) v', 'OrderedDate') : null,
        hasRO ? one('Returns', 'ReturnOrder', 'COUNT(Id) c, SUM(GrandTotalAmount) v', 'CreatedDate') : null,
        hasPE ? one('Process exceptions', 'ProcessException', 'COUNT(Id) c', 'CreatedDate') : null,
        hasCM ? one('Refunds issued', 'CreditMemo', 'COUNT(Id) c, SUM(TotalAmount) v', 'CreatedDate') : null,
        hasFO ? one('Fulfillment orders', 'FulfillmentOrder', 'COUNT(Id) c', 'CreatedDate') : null,
      ]);
      const pair = (x, f) => (x ? { cur: x.cur?.[f] ?? 0, prev: x.prev ? x.prev[f] ?? 0 : null } : null);
      return { orders: pair(o, 'c'), value: pair(o, 'v'), returns: pair(r, 'c'), returnValue: pair(r, 'v'), exceptions: pair(e, 'c'), refunds: pair(cm, 'v'), refundCount: pair(cm, 'c'), fos: pair(fo, 'c') };
    });
    const ordersSeries = safe(async () => hasOS ? series('Orders over time', 'OrderSummary', 'OrderedDate') : []);
    const returnsSeries = safe(async () => hasRO ? series('Returns over time', 'ReturnOrder', 'CreatedDate') : []);
    const channels = safe(async () => hasOS ? group('Sales channel mix', 'OrderSummary', 'SalesChannel.SalesChannelName', 'OrderedDate', '', 'COUNT(Id)', 8) : []);
    const exCategory = safe(async () => hasPE ? group('Process exceptions by category', 'ProcessException', 'Category', 'CreatedDate', '', 'COUNT(Id)', 10) : []);
    const exStatus = safe(async () => hasPE ? group('Process exceptions by status', 'ProcessException', 'Status', 'CreatedDate') : []);
    const foStatus = safe(async () => hasFO ? group('Fulfillment orders by status', 'FulfillmentOrder', 'Status', 'CreatedDate') : []);
    const foMix = safe(async () => hasFO ? group('Fulfillment mix by location type', 'FulfillmentOrder', 'FulfilledFromLocation.LocationType', 'CreatedDate') : []);
    const retStatus = safe(async () => hasRO ? group('Returns by status', 'ReturnOrder', 'Status', 'CreatedDate') : []);
    const retReasons = safe(async () => hasROLI ? group('Return drivers', 'ReturnOrderLineItem', 'ReasonForReturn', 'ReturnOrder.CreatedDate', "TypeCode = 'Product'", 'SUM(QuantityReturned)', 10) : []);
    const retProducts = safe(async () => hasROLI ? group('Most-returned products', 'ReturnOrderLineItem', 'Product2.Name', 'ReturnOrder.CreatedDate', "TypeCode = 'Product'", 'SUM(QuantityReturned)', 8) : []);

    // ---- deeper panels: speed, locations, carriers, money, cancellations, basket, service, return mix ----
    // Durations aren't aggregatable in SOQL, so these pull the newest 2,000 rows in the period and compute percentiles here.
    const ROWS = 2000;
    const rowsQ = async (panel, object, fields, where) => q(panel, object, `SELECT ${fields.join(', ')} FROM ${object} WHERE ${where}${A(object)} ORDER BY CreatedDate DESC LIMIT ${ROWS}`);
    const hrs = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 36e5 : null);
    const pctl = (xs, p) => { if (!xs.length) return null; const v = [...xs].sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(p * v.length))]; };
    const hist = (xs, edges, labels) => labels.map((key, i) => ({ key, n: xs.filter((x) => x >= edges[i] && (i === edges.length - 1 || x < edges[i + 1])).length }));
    const dist = (xs, edges, labels) => ({ n: xs.length, p50: pctl(xs, 0.5), p90: pctl(xs, 0.9), hist: hist(xs, edges, labels) });
    const HOURS = [[0, 1, 4, 24, 72, 168], ['< 1 h', '1–4 h', '4–24 h', '1–3 d', '3–7 d', '7 d +']];
    const DAYS = [[0, 8, 15, 31, 61, 91], ['0–7 d', '8–14 d', '15–30 d', '31–60 d', '61–90 d', '90 d +']];
    const AGE = [['< 1 d', 0, 1], ['1–3 d', 1, 3], ['3–7 d', 3, 7], ['7–30 d', 7, 30], ['30–90 d', 30, 90], ['90 d +', 90, null]];
    // Backlog age is a snapshot of what's open now, independent of the period.
    const ageBuckets = (panel, object, openWhere) => Promise.all(AGE.map(async ([key, lo, hi]) => {
      const ago = (d) => lit(new Date(Date.now() - d * 864e5));
      const w = [openWhere, `CreatedDate <= ${ago(lo)}`, hi != null && `CreatedDate > ${ago(hi)}`].filter(Boolean).join(' AND ');
      return { key, n: (await q(panel, object, `SELECT COUNT(Id) c FROM ${object} WHERE ${w}${A(object)}`))[0]?.c ?? 0 };
    }));
    const byStatus = (rows) => Object.fromEntries(rows.map((r) => [r.s ?? '(blank)', { c: r.c ?? 0, a: r.a ?? 0 }]));

    // ---- Products tab: product lines (OrderItemSummary, TypeCode = 'Product') ordered in the period, grouped by product,
    // and open demand by product (FulfillmentOrderLineItem on open fulfillment orders, a snapshot of now). No customer fields.
    function productPanels() {
      const PROD = "TypeCode = 'Product'";
      const fields = hasOIS ? pick('OrderItemSummary', ['Product2Id', 'Product2.Name', 'QuantityOrdered', 'QuantityCanceled', 'QuantityReturned', 'TotalLineAmount', 'TotalPrice']) : Promise.resolve([]);
      // Columns every product query shares; null when the org can't group lines by product.
      const cols = fields.then((f) => {
        if (!f.includes('Product2.Name') || !f.includes('QuantityOrdered')) return null;
        const rev = ['TotalLineAmount', 'TotalPrice'].find((x) => f.includes(x)) || null, id = f.includes('Product2Id');
        const sums = [['QuantityOrdered', 'qo'], ['QuantityCanceled', 'qc'], ['QuantityReturned', 'qr'], [rev, 'amt']].filter(([x]) => x && f.includes(x)).map(([x, a]) => `SUM(${x}) ${a}`).join(', ');
        return { rev, id, sums, dims: id ? 'Product2Id, Product2.Name' : 'Product2.Name', sel: id ? 'Product2Id p, Product2.Name s' : 'Product2.Name s', where: `${cur('OrderSummary.OrderedDate')} AND ${PROD}${A('OrderItemSummary')}` };
      });
      const row = (r) => ({ id: r.p ?? null, key: r.s ?? '(no product)', qo: r.qo ?? 0, qc: r.qc ?? null, qr: r.qr ?? null, amt: r.amt ?? null });
      return {
        prodTotals: safe(async () => {
          const c = await cols;
          return c ? one('Products · totals', 'OrderItemSummary', `${c.id ? 'COUNT_DISTINCT(Product2Id) n, ' : ''}${c.sums}`, 'OrderSummary.OrderedDate', PROD) : null;
        }),
        prodTop: safe(async () => {
          const c = await cols;
          if (!c) return null;
          const rows = (await q('Products · units and rates', 'OrderItemSummary', `SELECT ${c.sel}, ${c.sums} FROM OrderItemSummary WHERE ${c.where} GROUP BY ${c.dims} ORDER BY SUM(QuantityOrdered) DESC LIMIT ${PROD_ROWS}`)).map(row);
          return { top: rows.slice(0, 10), ...productRates(rows), products: rows.length, capped: rows.length === PROD_ROWS, revenue: c.rev };
        }),
        prodRevenue: safe(async () => {
          const c = await cols;
          if (!c?.rev) return null;
          return (await q('Products · revenue', 'OrderItemSummary', `SELECT ${c.sel}, ${c.sums} FROM OrderItemSummary WHERE ${c.where} GROUP BY ${c.dims} ORDER BY SUM(${c.rev}) DESC LIMIT 10`)).map(row);
        }),
        prodFamily: safe(async () => {
          const [c, fam] = await Promise.all([cols, hasOIS ? pick('Product2', ['Family']) : []]);
          if (!c || !fam.length) return null;
          return (await q('Product family mix', 'OrderItemSummary', `SELECT Product2.Family s, ${c.id ? 'COUNT_DISTINCT(Product2Id) n, ' : ''}${c.sums} FROM OrderItemSummary WHERE ${c.where} GROUP BY Product2.Family ORDER BY SUM(QuantityOrdered) DESC LIMIT 12`))
            .map((r) => ({ key: r.s ?? '(no family)', products: r.n ?? null, qo: r.qo ?? 0, amt: r.amt ?? null }));
        }),
        prodDemand: safe(async () => {
          if (!(await has('FulfillmentOrderLineItem'))) return null;
          const f = await pick('FulfillmentOrderLineItem', ['Product2Id', 'Product2.Name', 'Quantity', 'TypeCode', 'FulfillmentOrderId', 'FulfillmentOrder.Status']);
          if (!['Product2.Name', 'Quantity', 'FulfillmentOrder.Status'].every((x) => f.includes(x))) return null;
          const id = f.includes('Product2Id'), fo = f.includes('FulfillmentOrderId') ? ', COUNT_DISTINCT(FulfillmentOrderId) f' : '';
          const where = `FulfillmentOrder.Status NOT IN ${FO_DONE} AND Quantity > 0${f.includes('TypeCode') ? ' AND ' + PROD : ''}${A('FulfillmentOrderLineItem')}`;
          const [rows, tot] = await Promise.all([
            q('Open demand by product', 'FulfillmentOrderLineItem', `SELECT ${id ? 'Product2Id p, ' : ''}Product2.Name s, SUM(Quantity) q${fo} FROM FulfillmentOrderLineItem WHERE ${where} GROUP BY ${id ? 'Product2Id, ' : ''}Product2.Name ORDER BY SUM(Quantity) DESC LIMIT 10`),
            q('Open demand by product', 'FulfillmentOrderLineItem', `SELECT SUM(Quantity) q${id ? ', COUNT_DISTINCT(Product2Id) n' : ''}${fo} FROM FulfillmentOrderLineItem WHERE ${where}`)]);
          return { units: tot[0]?.q ?? 0, products: tot[0]?.n ?? null, fos: tot[0]?.f ?? null,
            list: rows.map((r) => ({ id: r.p ?? null, key: r.s ?? '(no product)', n: r.q ?? 0, fos: r.f ?? null })) };
        }),
      };
    }

    const extra = {
      speed: safe(async () => {
        if (!hasFO) return null;
        const f = await pick('FulfillmentOrder', ['CreatedDate', 'ClosedDate', 'Status', 'FulfilledFromLocation.Name', 'OrderSummary.OrderedDate']);
        const rows = await rowsQ('Fulfillment speed', 'FulfillmentOrder', f, cur('CreatedDate'));
        const route = rows.map((r) => hrs(r.OrderSummary?.OrderedDate, r.CreatedDate)).filter((x) => x != null && x >= 0);
        const close = rows.map((r) => hrs(r.CreatedDate, r.ClosedDate)).filter((x) => x != null && x >= 0);
        const perLoc = {};
        for (const r of rows) { const h = hrs(r.OrderSummary?.OrderedDate, r.CreatedDate), k = r.FulfilledFromLocation?.Name || '(no location)'; if (h != null && h >= 0) (perLoc[k] ||= []).push(h); }
        return { rows: rows.length, capped: rows.length === ROWS, route: dist(route, ...HOURS), close: dist(close, ...HOURS), routeByLoc: Object.fromEntries(Object.entries(perLoc).map(([k, v]) => [k, pctl(v, 0.5)])),
          openAge: await ageBuckets('Open fulfillment order age', 'FulfillmentOrder', OPEN_FO) };
      }),
      locations: safe(async () => {
        if (!hasFO) return [];
        const rows = await q('Location scorecard', 'FulfillmentOrder', `SELECT FulfilledFromLocation.Name s, FulfilledFromLocation.LocationType t, Status st, COUNT(Id) c FROM FulfillmentOrder WHERE ${cur('CreatedDate')}${A('FulfillmentOrder')} GROUP BY FulfilledFromLocation.Name, FulfilledFromLocation.LocationType, Status`);
        const m = {};
        for (const r of rows) {
          const k = r.s || '(no location)', x = (m[k] ||= { name: k, type: r.t || '', total: 0, fulfilled: 0, rejected: 0, cancelled: 0, open: 0 });
          x.total += r.c; if (FO_FULFILLED.includes(r.st)) x.fulfilled += r.c; else if (r.st === 'Rejected') x.rejected += r.c; else if (r.st === 'Cancelled') x.cancelled += r.c; else if (r.st !== 'Closed') x.open += r.c;
        }
        return Object.values(m).sort((a, b) => b.total - a.total);
      }),
      locGroups: safe(async () => {
        if (!hasFO || !hasLGA) return [];
        const [asg, fo] = await Promise.all([
          q('Location groups', 'LocationGroupAssignment', 'SELECT LocationId, LocationGroupName FROM LocationGroupAssignment LIMIT 2000'),
          q('Location groups', 'FulfillmentOrder', `SELECT FulfilledFromLocationId l, COUNT(Id) c FROM FulfillmentOrder WHERE ${cur('CreatedDate')}${A('FulfillmentOrder')} GROUP BY FulfilledFromLocationId`)]);
        const byLoc = Object.fromEntries(fo.map((r) => [r.l, r.c])), g = {};
        for (const a of asg) { const x = (g[a.LocationGroupName || '(unnamed)'] ||= { key: a.LocationGroupName || '(unnamed)', locations: 0, n: 0 }); x.locations++; x.n += byLoc[a.LocationId] || 0; }
        return Object.values(g).sort((a, b) => b.n - a.n || b.locations - a.locations);
      }),
      carriers: safe(async () => {
        if (!hasSH) return null;
        const f = await pick('Shipment', ['Provider', 'Status', 'CreatedDate', 'ExpectedDeliveryDate', 'ActualDeliveryDate']);
        const rows = await rowsQ('Carrier performance', 'Shipment', f, cur('CreatedDate')), m = {};
        for (const r of rows) {
          const x = (m[r.Provider || '(not set)'] ||= { key: r.Provider || '(not set)', n: 0, delivered: 0, measured: 0, onTime: 0, transit: [] , status: {} });
          x.n++; x.status[r.Status || '(blank)'] = (x.status[r.Status || '(blank)'] || 0) + 1;
          if (r.ActualDeliveryDate) { x.delivered++; x.transit.push(hrs(r.CreatedDate, r.ActualDeliveryDate) / 24); if (r.ExpectedDeliveryDate) { x.measured++; if (new Date(r.ActualDeliveryDate) <= new Date(r.ExpectedDeliveryDate)) x.onTime++; } }
        }
        const list = Object.values(m).sort((a, b) => b.n - a.n).map(({ transit, ...x }) => ({ ...x, transitP50: pctl(transit, 0.5) }));
        return { total: rows.length, withActual: list.reduce((s, x) => s + x.delivered, 0), list };
      }),
      money: safe(async () => {
        const agg = async (panel, object, sel, extra2 = '') => q(panel, object, `SELECT ${sel} FROM ${object} WHERE ${cur('CreatedDate')}${A(object)}${extra2}`);
        const [pa, pay, inv, ref] = await Promise.all([
          hasPA ? agg('Money flow · authorized', 'PaymentAuthorization', 'Status s, COUNT(Id) c, SUM(Amount) a', ' GROUP BY Status') : [],
          hasPAY ? agg('Money flow · captured', 'Payment', 'Status s, COUNT(Id) c, SUM(Amount) a', ' GROUP BY Status') : [],
          hasINV ? agg('Money flow · invoiced', 'Invoice', 'COUNT(Id) c, SUM(TotalAmountWithTax) a, SUM(Balance) b') : [],
          hasREF ? agg('Money flow · refunded', 'Refund', 'Status s, COUNT(Id) c, SUM(Amount) a', ' GROUP BY Status') : []]);
        return { auth: byStatus(pa), pay: byStatus(pay), inv: { c: inv[0]?.c ?? 0, a: inv[0]?.a ?? 0, b: inv[0]?.b ?? 0 }, ref: byStatus(ref),
          objects: { PaymentAuthorization: hasPA, Payment: hasPAY, Invoice: hasINV, Refund: hasREF } };
      }),
      // Money still open on orders: invoices with a balance on shipped orders (billed, not paid) and credit memos with a balance
      // (credit issued for a cancel or return, but nothing refunded or applied yet). Both point at the order through ReferenceEntityId.
      settlement: safe(async () => {
        if (!hasOS || (!hasINV && !hasCM)) return null;
        const SHIPPED = "('Fulfilled','Partially Fulfilled')", aOS = A('OrderSummary');
        const open = async (ok, object, panel, statuses) => {
          if (!ok) return null;
          const f = await pick(object, ['ReferenceEntityId', 'Balance', 'TotalAmountWithTax']);
          if (f.length < 3) return null;
          const inOS = [statuses && `Status IN ${statuses}`, sc.where('OrderSummary')].filter(Boolean).join(' AND ');
          const where = `${cur('CreatedDate')} AND Balance > 0.01 AND ReferenceEntityId IN (SELECT Id FROM OrderSummary${pre(' WHERE ', inOS)})`;
          const [tot, top] = await Promise.all([
            q(panel, object, `SELECT COUNT_DISTINCT(ReferenceEntityId) n, COUNT(Id) c, SUM(Balance) b FROM ${object} WHERE ${where}`),
            q(panel, object, `SELECT ReferenceEntityId o, COUNT(Id) c, SUM(TotalAmountWithTax) t, SUM(Balance) b, MAX(CreatedDate) d FROM ${object} WHERE ${where} GROUP BY ReferenceEntityId ORDER BY SUM(Balance) DESC LIMIT 10`)]);
          return { orders: tot[0]?.n ?? 0, docs: tot[0]?.c ?? 0, amount: tot[0]?.b ?? 0, top };
        };
        const [unpaid, unrefunded, noInvoice] = await Promise.all([
          open(hasINV, 'Invoice', 'Shipped, not paid', SHIPPED),
          open(hasCM, 'CreditMemo', 'Refund owed, not created', null),
          hasINV ? q('Shipped, not invoiced', 'OrderSummary', `SELECT COUNT(Id) c FROM OrderSummary WHERE ${cur('OrderedDate')} AND Status IN ${SHIPPED} AND Id NOT IN (SELECT ReferenceEntityId FROM Invoice)${aOS}`) : null]);
        // Order number and status for the listed orders, in one query.
        const ids = [...new Set([unpaid, unrefunded].flatMap((x) => x?.top || []).map((r) => r.o).filter((id) => id && ID_RE.test(id)))];
        const os = ids.length ? await q('Shipped, not paid · orders', 'OrderSummary', `SELECT Id, OrderNumber, Status FROM OrderSummary WHERE Id IN (${ids.map((id) => `'${id}'`).join(', ')})`) : [];
        const byId = Object.fromEntries(os.map((r) => [r.Id, r]));
        const list = (x) => x && { orders: x.orders, docs: x.docs, amount: x.amount,
          top: x.top.map((r) => ({ id: r.o, number: byId[r.o]?.OrderNumber ?? null, status: byId[r.o]?.Status ?? null, docs: r.c ?? 0, total: r.t ?? 0, balance: r.b ?? 0, at: r.d ?? null })) };
        return { unpaid: list(unpaid), unrefunded: list(unrefunded), noInvoice: noInvoice ? noInvoice[0]?.c ?? 0 : null, objects: { Invoice: hasINV, CreditMemo: hasCM } };
      }),
      lines: safe(async () => hasOIS ? one('Basket · cancel rate', 'OrderItemSummary', 'SUM(QuantityOrdered) qo, SUM(QuantityCanceled) qc, SUM(QuantityReturned) qr, SUM(TotalLineAdjustmentAmount) adj, SUM(TotalLineAmount) amt, COUNT(Id) l, COUNT_DISTINCT(OrderSummaryId) o', 'OrderSummary.OrderedDate', "TypeCode = 'Product'") : null),
      cancelled: safe(async () => {
        if (!hasOIS) return null;
        const f = await pick('OrderItemSummary', ['QuantityCanceled', 'UnitPrice', 'Product2.Name', 'Name']);
        const rows = await rowsQ('Cancelled value · products', 'OrderItemSummary', f, `${cur('OrderSummary.OrderedDate')} AND TypeCode = 'Product' AND QuantityCanceled > 0`), p = {};
        for (const r of rows) { const k = r.Product2?.Name || r.Name || '(unknown)', x = (p[k] ||= { key: k, n: 0, v: 0 }); x.n += r.QuantityCanceled || 0; x.v += (r.QuantityCanceled || 0) * (r.UnitPrice || 0); }
        return { value: Object.values(p).reduce((s, x) => s + x.v, 0), capped: rows.length === ROWS, products: Object.values(p).sort((a, b) => b.n - a.n || Math.round(b.v * 100) - Math.round(a.v * 100) || a.key.localeCompare(b.key)).slice(0, 8) };
      }),
      cancelReasons: safe(async () => hasOISC ? group('Cancel reasons', 'OrderItemSummaryChange', 'Reason', 'CreatedDate', "ChangeType = 'Cancel'", 'COUNT(Id)', 10) : []),
      cancelWhen: safe(async () => hasOISC ? group('Cancel timing', 'OrderItemSummaryChange', 'IsPreFulfillment', 'CreatedDate', "ChangeType = 'Cancel'") : []),
      changes: safe(async () => hasOISC ? group('Order changes by type', 'OrderItemSummaryChange', 'ChangeType', 'CreatedDate') : []),
      exAge: safe(async () => hasPE ? ageBuckets('Open exception age', 'ProcessException', OPEN_PE) : []),
      exResolve: safe(async () => {
        if (!hasPE) return null;
        const rows = await rowsQ('Time to resolve', 'ProcessException', ['Category', 'CreatedDate', 'LastModifiedDate'], `Status = 'Resolved' AND ${cur('LastModifiedDate')}`), m = {};
        for (const r of rows) (m[r.Category || '(none)'] ||= []).push(hrs(r.CreatedDate, r.LastModifiedDate));
        const all = Object.values(m).flat();
        return { n: all.length, p50: pctl(all, 0.5), p90: pctl(all, 0.9), byCategory: Object.entries(m).map(([key, v]) => ({ key, n: pctl(v, 0.5), count: v.length })).sort((a, b) => b.count - a.count).slice(0, 6) };
      }),
      cases: safe(async () => {
        if (!hasCASE) return null;
        const [cnt, type, status, origin, closed] = await Promise.all([
          one('Customer service', 'Case', 'COUNT(Id) c', 'CreatedDate'),
          group('Cases by type', 'Case', 'Type', 'CreatedDate', '', 'COUNT(Id)', 8),
          group('Cases by status', 'Case', 'Status', 'CreatedDate'),
          group('Cases by origin', 'Case', 'Origin', 'CreatedDate'),
          rowsQ('Time to close', 'Case', ['CreatedDate', 'ClosedDate'], `IsClosed = true AND ${cur('CreatedDate')}`)]);
        const t = closed.map((r) => hrs(r.CreatedDate, r.ClosedDate)).filter((x) => x != null && x >= 0);
        return { count: { cur: cnt.cur?.c ?? 0, prev: cnt.prev ? cnt.prev.c ?? 0 : null }, type, status, origin, close: { n: t.length, p50: pctl(t, 0.5) } };
      }),
      retDays: safe(async () => {
        if (!hasRO) return null;
        const rows = await rowsQ('Days to return', 'ReturnOrder', ['CreatedDate', 'OrderSummary.OrderedDate'], cur('CreatedDate'));
        return dist(rows.map((r) => hrs(r.OrderSummary?.OrderedDate, r.CreatedDate)).filter((x) => x != null && x >= 0).map((h) => h / 24), ...DAYS);
      }),
      retByChannel: safe(async () => hasOIS ? (await q('Return rate by channel', 'OrderItemSummary', `SELECT OrderSummary.SalesChannel.SalesChannelName s, SUM(QuantityReturned) r, SUM(QuantityOrdered) o FROM OrderItemSummary WHERE ${cur('OrderSummary.OrderedDate')} AND TypeCode = 'Product'${A('OrderItemSummary')} GROUP BY OrderSummary.SalesChannel.SalesChannelName ORDER BY SUM(QuantityOrdered) DESC LIMIT 10`))
        .map((r) => ({ key: r.s ?? '(blank)', returned: r.r ?? 0, ordered: r.o ?? 0 })) : []),
      retByProduct: safe(async () => hasOIS ? (await q('Return rate by product', 'OrderItemSummary', `SELECT Product2.Name s, SUM(QuantityReturned) r, SUM(QuantityOrdered) o FROM OrderItemSummary WHERE ${cur('OrderSummary.OrderedDate')} AND TypeCode = 'Product'${A('OrderItemSummary')} GROUP BY Product2.Name ORDER BY SUM(QuantityReturned) DESC LIMIT 8`))
        .filter((r) => r.r > 0).map((r) => ({ key: r.s ?? '(blank)', returned: r.r ?? 0, ordered: r.o ?? 0 })) : []),
      retOutcome: safe(async () => {
        const exF = hasOS && (await pick('OrderSummary', ['SourceProcess'])).length;
        const [repay, plan, exch, refunds] = await Promise.all([
          hasROLI ? group('Return outcome · repayment', 'ReturnOrderLineItem', 'RepaymentMethod', 'ReturnOrder.CreatedDate', "TypeCode = 'Product'", 'SUM(QuantityReturned)') : [],
          hasROLI ? group('Return outcome · processing plan', 'ReturnOrderLineItem', 'ProcessingPlan', 'ReturnOrder.CreatedDate', "TypeCode = 'Product'", 'SUM(QuantityReturned)') : [],
          exF ? one('Exchange orders', 'OrderSummary', 'COUNT(Id) c', 'OrderedDate', "SourceProcess = 'Exchange'") : null,
          hasREF ? one('Refunds processed', 'Refund', 'COUNT(Id) c, SUM(Amount) a', 'CreatedDate', "Status = 'Processed'") : null]);
        return { repay, plan, exchanges: exch ? exch.cur?.c ?? 0 : null, refunds: refunds ? { c: refunds.cur?.c ?? 0, a: refunds.cur?.a ?? 0 } : null };
      }),
      // Customers who ordered in the period. Canceled orders aren't spend. Counts come from GROUP BY AccountId rows, capped at 2,000.
      customers: safe(async () => {
        if (!hasOS) return null;
        const acc = `AccountId != null AND ${NOT_CANCELED}`, where = `${cur('OrderedDate')} AND ${acc}${A('OrderSummary')}`;
        const [personF, roAcc] = await Promise.all([pick('Account', ['IsPersonAccount']), hasRO ? pick('ReturnOrder', ['AccountId']) : []]);
        const aRO = roAcc.length ? A('ReturnOrder') : '';
        const top = (panel, order) => q(panel, 'OrderSummary', `SELECT AccountId a, Account.Name nm, COUNT(Id) c, SUM(GrandTotalAmount) v FROM OrderSummary WHERE ${where} GROUP BY AccountId, Account.Name ORDER BY ${order} DESC LIMIT 10`);
        const [tot, bySpend, byOrders, repeat, fresh, rets, kind] = await Promise.all([
          one('Customers', 'OrderSummary', 'COUNT_DISTINCT(AccountId) c, SUM(GrandTotalAmount) v, COUNT(Id) o', 'OrderedDate', acc),
          top('Top accounts by spend', 'SUM(GrandTotalAmount)'),
          top('Most frequent shoppers', 'COUNT(Id)'),
          q('Repeat customers', 'OrderSummary', `SELECT AccountId FROM OrderSummary WHERE ${where} GROUP BY AccountId HAVING COUNT(Id) > 1 LIMIT 2000`),
          w.from ? q('New customers', 'OrderSummary', `SELECT AccountId FROM OrderSummary WHERE ${acc}${A('OrderSummary')} GROUP BY AccountId HAVING MIN(OrderedDate) >= ${lit(w.from)} LIMIT 2000`) : null,
          roAcc.length ? q('Top returners', 'ReturnOrder', `SELECT AccountId a, Account.Name nm, COUNT(Id) c, SUM(GrandTotalAmount) v FROM ReturnOrder WHERE ${cur('CreatedDate')} AND AccountId != null${aRO} GROUP BY AccountId, Account.Name ORDER BY COUNT(Id) DESC LIMIT 10`) : [],
          personF.length ? q('Customer type', 'OrderSummary', `SELECT Account.IsPersonAccount p, COUNT_DISTINCT(AccountId) c, SUM(GrandTotalAmount) v FROM OrderSummary WHERE ${where} GROUP BY Account.IsPersonAccount`) : null]);
        // Second pass: returns for the top shoppers, and spend for the top returners, in the same period.
        const inList = (rows) => [...new Set(rows.map((r) => r.a).filter((id) => ID_RE.test(id)))].map((id) => `'${id}'`).join(', ');
        const shoppers = inList([...bySpend, ...byOrders]), returners = inList(rets);
        const [theirRets, theirSpend] = await Promise.all([
          roAcc.length && shoppers ? q('Top accounts · returns', 'ReturnOrder', `SELECT AccountId a, COUNT(Id) c, SUM(GrandTotalAmount) v FROM ReturnOrder WHERE ${cur('CreatedDate')} AND AccountId IN (${shoppers})${aRO} GROUP BY AccountId`) : [],
          returners ? q('Top returners · spend', 'OrderSummary', `SELECT AccountId a, COUNT(Id) c, SUM(GrandTotalAmount) v FROM OrderSummary WHERE ${where} AND AccountId IN (${returners}) GROUP BY AccountId`) : []]);
        const by = (rows) => Object.fromEntries(rows.map((r) => [r.a, r]));
        const rMap = by(theirRets), sMap = by(theirSpend);
        const row = (r, o, rt) => ({ id: r.a, name: r.nm || '(no name)', orders: o?.c ?? 0, spend: o?.v ?? 0, returns: rt?.c ?? 0, returned: rt?.v ?? 0 });
        return {
          count: { cur: tot.cur?.c ?? 0, prev: tot.prev ? tot.prev.c ?? 0 : null }, spend: { cur: tot.cur?.v ?? 0, prev: tot.prev ? tot.prev.v ?? 0 : null }, orders: tot.cur?.o ?? 0,
          repeat: repeat.length, fresh: fresh ? fresh.length : null, capped: repeat.length === 2000 || fresh?.length === 2000,
          bySpend: bySpend.map((r) => row(r, r, rMap[r.a])), byOrders: byOrders.map((r) => row(r, r, rMap[r.a])), returners: rets.map((r) => row(r, sMap[r.a], r)),
          kind: kind && kind.map((r) => ({ key: r.p ? 'Person accounts' : 'Business accounts', n: r.c ?? 0, v: r.v ?? 0 })),
          objects: { ReturnOrder: !!roAcc.length, IsPersonAccount: !!personF.length } };
      }),
      ...productPanels(),
    };

    const [t, os, rs, ch, ec, es, fs, fm, rst, rr, rp, ...more] = await Promise.all([tiles, ordersSeries, returnsSeries, channels, exCategory, exStatus, foStatus, foMix, retStatus, retReasons, retProducts, ...Object.values(extra)]);
    return { period: key, scope: sc.scope, grain, from: w.from && w.from.toISOString(), to: w.to.toISOString(), prevFrom: w.prevFrom && w.prevFrom.toISOString(), prevTo: w.prevTo && w.prevTo.toISOString(),
      objects: { OrderSummary: hasOS, FulfillmentOrder: hasFO, ProcessException: hasPE, ReturnOrder: hasRO, CreditMemo: hasCM, OrderItemSummary: hasOIS, OrderItemSummaryChange: hasOISC,
        PaymentAuthorization: hasPA, Payment: hasPAY, Invoice: hasINV, Refund: hasREF, Case: hasCASE, Shipment: hasSH, LocationGroupAssignment: hasLGA },
      tiles: t, ordersSeries: os, returnsSeries: rs, channels: ch, exCategory: ec, exStatus: es, foStatus: fs, foMix: fm, retStatus: rst, retReasons: rr, retProducts: rp,
      ...Object.fromEntries(Object.keys(extra).map((k, i) => [k, more[i]])),
      sources, at: new Date().toISOString() };
  }

  const routes = [['/api/dashboard', (m, q) => dashboardData(q('period'), scopeOf(q))]];
  return { dashboardData, routes };
}
