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
// Operations Console map and KPI queries.
import { scopeOf, pre } from '../../shared/data/om-core-util.js';
import { RANGES, ID_RE, OPEN_PE, OPEN_FO, YEAR } from '../../shared/data/om-reads.js';

export function commandReads(k) {
  const { soql, describe, has, pick, safe, agg, scoper } = k;
  // A Case's state: the related order's ship-to, then its bill-to, then the Account's billing state. Orgs link Cases to orders
  // through different (often custom) lookups, so every single-target lookup to OrderSummary, then Order, is tried in that order.
  async function caseStatePaths() {
    const [cs, os, od, ac] = await Promise.all(['Case', 'OrderSummary', 'Order', 'Account'].map(describe));
    if (!cs) return [];
    const to = (t) => Object.entries(cs.to).filter(([, r]) => r.length === 1 && r[0] === t).map(([rel]) => rel), paths = [];
    for (const rel of to('OrderSummary')) {
      if (os?.rels.has('OriginalOrder') && od?.fields.has('ShippingState')) paths.push(`${rel}.OriginalOrder.ShippingState`);
      if (os?.fields.has('BillingState')) paths.push(`${rel}.BillingState`);
    }
    for (const rel of to('Order')) ['ShippingState', 'BillingState'].forEach((f) => od?.fields.has(f) && paths.push(`${rel}.${f}`));
    if (cs.rels.has('Account') && ac?.fields.has('BillingState')) paths.push('Account.BillingState');
    return paths;
  }

  // ---------- console read model ----------
  async function consoleData(rangeKey, scope) {
    const range = RANGES[rangeKey] || RANGES['7d'];
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
    // The filters' describes and the objects' run side by side (both are schema reads, cached once read).
    const [sc, [hasOS, hasFO, hasPE, hasLoc, hasODGS, hasAP, hasRO, hasSH, hasCASE]] = await Promise.all([scoper(scope), Promise.all(
      ['OrderSummary', 'FulfillmentOrder', 'ProcessException', 'Location', 'OrderDeliveryGroupSummary', 'Agent_Proposal__c', 'ReturnOrder', 'Shipment', 'Case'].map(has))]), A = sc.and;

    // Each panel works out its conditions before it asks, so one that can't be filtered asks nothing.
    const kpis = safe(async () => {
      const aOS = hasOS ? A('OrderSummary') : '', aFO = hasFO ? A('FulfillmentOrder') : '', aPE = hasPE ? A('ProcessException') : '', aRO = hasRO ? A('ReturnOrder') : '';
      const [ordersAgg, stuck, holds, openEx, waiting, rets] = await Promise.all([
        hasOS ? soql(`SELECT COUNT(Id) c, SUM(GrandTotalAmount) v FROM OrderSummary WHERE OrderedDate = ${range}${aOS}`) : null,
        hasFO ? soql(`SELECT COUNT(Id) c FROM FulfillmentOrder WHERE CreatedDate = ${YEAR} AND Status IN ('Allocated','Pickpack') AND SystemModstamp < ${twoHoursAgo}${aFO}`) : null,
        hasPE ? soql(`SELECT COUNT(Id) c FROM ProcessException WHERE Category = 'Payment' AND ${OPEN_PE} AND CreatedDate = ${range}${aPE}`) : null,
        hasPE ? soql(`SELECT COUNT(Id) c FROM ProcessException WHERE ${OPEN_PE} AND CreatedDate = ${range}${aPE}`) : null,
        hasAP && sc.can('Agent_Proposal__c') ? soql(`SELECT COUNT(Id) c FROM Agent_Proposal__c WHERE Status__c = 'Proposed'`) : null,
        hasRO ? soql(`SELECT COUNT(Id) c, SUM(GrandTotalAmount) v FROM ReturnOrder WHERE CreatedDate = ${range}${aRO}`) : null,
      ]);
      return {
        orders: ordersAgg?.[0]?.c ?? null, value: ordersAgg?.[0]?.v ?? null,
        stuck: stuck?.[0]?.c ?? null, paymentHolds: holds?.[0]?.c ?? null,
        openExceptions: openEx?.[0]?.c ?? null, waiting: waiting?.[0]?.c ?? null,
        returns: rets?.[0]?.c ?? null, returnValue: rets?.[0]?.v ?? null,
      };
    });

    const statusBoard = safe(async () => ({
      orders: hasOS ? agg(await soql(`SELECT Status s, COUNT(Id) c FROM OrderSummary WHERE OrderedDate = ${range}${A('OrderSummary')} GROUP BY Status`)) : [],
      fulfillment: hasFO ? agg(await soql(`SELECT Status s, COUNT(Id) c FROM FulfillmentOrder WHERE CreatedDate = ${range}${A('FulfillmentOrder')} GROUP BY Status`)) : [],
    }));

    const network = safe(async () => {
      if (!hasLoc) return [];
      // Coordinates can live on Location itself or on its visitor Address (common in OM demo orgs); use whichever is set.
      const f = await pick('Location', ['Id', 'Name', 'LocationType', 'Latitude', 'Longitude', 'VisitorAddressId', 'FulfillmentOrderCapacity', 'AssignedFulfillmentOrderCount']);
      if (!f.includes('Latitude') && !f.includes('VisitorAddressId')) return [];
      const aFO = hasFO ? A('FulfillmentOrder') : '';
      const [locs, open] = await Promise.all([
        soql(`SELECT ${f.join(', ')} FROM Location WHERE LocationType != 'Virtual' LIMIT 200`),
        hasFO ? soql(`SELECT FulfilledFromLocationId l, COUNT(Id) c FROM FulfillmentOrder WHERE CreatedDate = ${YEAR} AND ${OPEN_FO}${aFO} GROUP BY FulfilledFromLocationId`).catch(() => []) : [],
      ]);
      const addrIds = locs.map((l) => l.VisitorAddressId).filter((id) => id && ID_RE.test(id));
      const addrs = addrIds.length ? await soql(`SELECT Id, Latitude, Longitude, City, State FROM Address WHERE Id IN ('${addrIds.join("','")}')`).catch(() => []) : [];
      const addrBy = Object.fromEntries(addrs.map((a) => [a.Id, a]));
      const openBy = Object.fromEntries(open.map((r) => [r.l, r.c]));
      return locs.map((l) => {
        const a = addrBy[l.VisitorAddressId] || {};
        return {
          id: l.Id, name: l.Name, type: l.LocationType, lat: l.Latitude ?? a.Latitude, lon: l.Longitude ?? a.Longitude, city: a.City, state: a.State,
          cap: l.FulfillmentOrderCapacity ?? null, assigned: l.AssignedFulfillmentOrderCount ?? null, openFOs: openBy[l.Id] || 0,
        };
      }).filter((n) => n.lat != null && n.lon != null);
    });

    const demand = safe(async () => hasODGS
      ? agg(await soql(`SELECT DeliverToState s, COUNT(Id) c FROM OrderDeliveryGroupSummary WHERE CreatedDate = ${range}${A('OrderDeliveryGroupSummary')} GROUP BY DeliverToState ORDER BY COUNT(Id) DESC LIMIT 60`))
      : []);

    // Fulfillment orders by origin location → ship-to state; drives the animated flow arcs.
    const flows = safe(async () => {
      if (!hasFO || !(await pick('FulfillmentOrder', ['FulfilledToState'])).length) return [];
      const rows = await soql(`SELECT FulfilledFromLocationId l, FulfilledToState s, COUNT(Id) c FROM FulfillmentOrder WHERE CreatedDate = ${range}${A('FulfillmentOrder')} GROUP BY FulfilledFromLocationId, FulfilledToState`);
      return rows.filter((r) => r.l && r.s).map((r) => ({ loc: r.l, state: r.s, n: r.c }));
    });

    // Open exceptions by the order's billing state (the nearest state an exception carries).
    const exByState = safe(async () => hasPE && (await pick('ProcessException', ['OrderSummary.Id'])).length
      ? agg(await soql(`SELECT OrderSummary.BillingState s, COUNT(Id) c FROM ProcessException WHERE ${OPEN_PE} AND CreatedDate = ${range}${A('ProcessException')} GROUP BY OrderSummary.BillingState`))
      : []);

    // Customers (distinct accounts with an order in range) by the order's billing city and state, plus each city's biggest spenders for the tooltip.
    // States are counted separately: a customer billed in two cities of one state is still one customer there.
    const customersByState = safe(async () => {
      if (!hasOS || (await pick('OrderSummary', ['AccountId', 'BillingState', 'BillingCity', 'GrandTotalAmount'])).length < 4) return null;
      const where = `OrderedDate = ${range} AND AccountId != null${A('OrderSummary')}`;
      const [st, city, top] = await Promise.all([
        soql(`SELECT BillingState s, COUNT_DISTINCT(AccountId) c, COUNT(Id) o, SUM(GrandTotalAmount) v FROM OrderSummary WHERE ${where} GROUP BY BillingState`),
        soql(`SELECT BillingState s, BillingCity y, COUNT_DISTINCT(AccountId) c, COUNT(Id) o, SUM(GrandTotalAmount) v FROM OrderSummary WHERE ${where} GROUP BY BillingState, BillingCity ORDER BY COUNT_DISTINCT(AccountId) DESC LIMIT 500`),
        soql(`SELECT BillingState s, BillingCity y, AccountId a, Account.Name nm, COUNT(Id) o, SUM(GrandTotalAmount) v FROM OrderSummary WHERE ${where} GROUP BY BillingState, BillingCity, AccountId, Account.Name ORDER BY SUM(GrandTotalAmount) DESC LIMIT 300`),
      ]);
      // GROUP BY is case-insensitive but each query may surface a different spelling ("San Mateo" vs "san mateo"), so match loosely.
      const key = (r) => `${r.s ?? ''}|${r.y ?? ''}`.toLowerCase().replace(/\s+/g, ' ').trim(), tops = {};
      top.forEach((r) => { const t = tops[key(r)] ||= []; if (t.length < 3) t.push({ id: r.a, name: r.nm, orders: r.o, spend: r.v || 0 }); });
      return {
        states: st.map((r) => ({ key: r.s ?? '(blank)', n: r.c, orders: r.o, spend: r.v || 0 })),
        cities: city.map((r) => ({ state: r.s, city: r.y, n: r.c, orders: r.o, spend: r.v || 0, top: tops[key(r)] || [] })),
      };
    });

    // Cases by state (see caseStatePaths); `via` counts which relationship placed each case, open vs closed and top origin/type ride along for the tooltip.
    const cases = safe(async () => {
      if (!hasCASE) return null;
      const paths = await caseStatePaths(), f = await pick('Case', ['IsClosed', 'Origin', 'Type']), AL = { IsClosed: 'cl', Origin: 'o', Type: 't' };
      const grp = [...paths, ...f], cols = [...paths.map((p, i) => p + ' s' + i), ...f.map((x) => x + ' ' + AL[x])].join(', ');
      const rows = await soql(`SELECT ${cols ? cols + ', ' : ''}COUNT(Id) c FROM Case WHERE CreatedDate = ${range}${A('Case')}${pre(' GROUP BY ', grp.join(', '))}`);
      const by = {}, via = {}, bump = (o, k, n) => { o[k] = (o[k] || 0) + n; };
      for (const r of rows.filter((r) => r.c)) {
        const i = paths.findIndex((_, k) => r[`s${k}`]), key = i < 0 ? '(blank)' : r[`s${i}`];
        const x = (by[key] ||= { key, n: 0, open: 0, closed: 0, origin: {}, type: {} });
        x.n += r.c; if (r.cl) x.closed += r.c; else x.open += r.c;
        bump(x.origin, r.o || '(none)', r.c); bump(x.type, r.t || '(none)', r.c); bump(via, i < 0 ? '(no state)' : paths[i], r.c);
      }
      const list = Object.values(by).sort((a, b) => b.n - a.n);
      return { list, paths, via, newest: list.length ? null : (await soql(`SELECT CreatedDate FROM Case${sc.clause('Case')} ORDER BY CreatedDate DESC LIMIT 1`))[0]?.CreatedDate ?? null };
    });

    const exceptions = safe(async () => {
      if (!hasPE) return [];
      const f = await pick('ProcessException', ['Id', 'ProcessExceptionNumber', 'Category', 'Status', 'Severity', 'Priority', 'Message', 'Description', 'OrderSummaryId', 'OrderSummary.OrderNumber', 'AttachedTo.Name', 'CreatedDate']);
      return soql(`SELECT ${f.join(', ')} FROM ProcessException WHERE ${OPEN_PE} AND CreatedDate = ${range}${A('ProcessException')} ORDER BY CreatedDate DESC LIMIT 100`);
    });

    const stream = safe(async () => {
      if (!hasOS) return [];
      const f = await pick('OrderSummary', ['Id', 'OrderNumber', 'Status', 'GrandTotalAmount', 'OrderedDate', 'LastModifiedDate', 'Account.Name', 'SalesChannel.SalesChannelName', 'BillingCity', 'BillingState']);
      return soql(`SELECT ${f.join(', ')} FROM OrderSummary WHERE SystemModstamp = ${range}${A('OrderSummary')} ORDER BY SystemModstamp DESC LIMIT 50`);
    });

    // Fulfillment / shipment / return streams sit beside the order stream, same range, newest activity first.
    // An empty stream also reports the newest record's date, so "nothing in range" isn't mistaken for "nothing at all".
    const newest = {};
    const recent = (ok, sobject, wanted) => safe(async () => {
      if (!ok) return [];
      const f = await pick(sobject, wanted);
      const a = A(sobject), list = await soql(`SELECT ${f.join(', ')} FROM ${sobject} WHERE SystemModstamp = ${range}${a} ORDER BY SystemModstamp DESC LIMIT 50`);
      if (!list.length) newest[sobject] = (await soql(`SELECT LastModifiedDate FROM ${sobject}${sc.clause(sobject)} ORDER BY SystemModstamp DESC LIMIT 1`))[0]?.LastModifiedDate ?? null;
      return list;
    });
    const foStream = recent(hasFO, 'FulfillmentOrder', ['Id', 'FulfillmentOrderNumber', 'Status', 'Type', 'FulfilledFromLocation.Name', 'FulfilledToName', 'FulfilledToCity', 'FulfilledToState', 'DeliveryMethod.Name', 'GrandTotalAmount', 'OrderSummaryId', 'OrderSummary.OrderNumber', 'LastModifiedDate']);
    const shStream = recent(hasSH, 'Shipment', ['Id', 'ShipmentNumber', 'Status', 'Provider', 'TrackingNumber', 'ShipToName', 'ShipToCity', 'ShipToState', 'ExpectedDeliveryDate', 'ActualDeliveryDate', 'FulfillmentOrder.FulfillmentOrderNumber', 'OrderSummaryId', 'OrderSummary.OrderNumber', 'LastModifiedDate']);
    const roStream = recent(hasRO, 'ReturnOrder', ['Id', 'ReturnOrderNumber', 'Status', 'GrandTotalAmount', 'Account.Name', 'OrderSummaryId', 'OrderSummary.OrderNumber', 'CreatedDate', 'LastModifiedDate']);

    // Cases link to orders through whichever single-target OrderSummary lookup the org has (often custom); rows are
    // normalized to OrderSummaryId / OrderSummary.OrderNumber so the stream can open the order like the other tabs.
    const caseStream = (async () => {
      const osRel = hasCASE ? Object.entries((await describe('Case'))?.to || {}).find(([, r]) => r.length === 1 && r[0] === 'OrderSummary')?.[0] : null;
      const p = await recent(hasCASE, 'Case', ['Id', 'CaseNumber', 'Subject', 'Status', 'Priority', 'Type', 'Origin', 'IsClosed', 'Account.Name', 'CreatedDate', 'LastModifiedDate', ...(osRel ? [`${osRel}.Id`, `${osRel}.OrderNumber`] : [])]);
      if (p.ok && osRel) p.data = p.data.map(({ [osRel]: os, ...r }) => ({ ...r, OrderSummaryId: os?.Id ?? null, OrderSummary: os ? { OrderNumber: os.OrderNumber } : null }));
      return p;
    })();

    const latest = safe(async () => hasOS ? (await soql(`SELECT OrderedDate FROM OrderSummary${sc.clause('OrderSummary')} ORDER BY CreatedDate DESC LIMIT 1`))[0]?.OrderedDate ?? null : null);
    const [k, sb, net, dem, fl, exs, cu, cs, ex, st, fos, shs, ros, css, lt] = await Promise.all([kpis, statusBoard, network, demand, flows, exByState, customersByState, cases, exceptions, stream, foStream, shStream, roStream, caseStream, latest]);
    return { range: rangeKey, scope: sc.scope, objects: { OrderSummary: hasOS, FulfillmentOrder: hasFO, ProcessException: hasPE, Location: hasLoc, Agent_Proposal__c: hasAP, ReturnOrder: hasRO, Shipment: hasSH, Case: hasCASE },
      kpis: k, statusBoard: sb, network: net, demand: dem, flows: fl, exByState: exs, customers: cu, cases: cs, exceptions: ex, stream: st, foStream: fos, shStream: shs, roStream: ros, caseStream: css, streamNewest: newest, latestOrder: lt.ok ? lt.data : null, at: new Date().toISOString() };
  }

  async function filterOptions() {
    const [osF, hasWS, hasSC] = await Promise.all([pick('OrderSummary', ['SalesStoreId', 'SalesChannelId']), has('WebStore'), has('SalesChannel')]);
    const [stores, channels] = await Promise.all([
      osF.includes('SalesStoreId') && hasWS ? soql('SELECT Id, Name FROM WebStore ORDER BY Name LIMIT 200') : null,
      osF.includes('SalesChannelId') && hasSC ? soql('SELECT Id, SalesChannelName FROM SalesChannel ORDER BY SalesChannelName LIMIT 200') : null]);
    return { stores: stores && stores.map((r) => ({ id: r.Id, name: r.Name || r.Id })), channels: channels && channels.map((r) => ({ id: r.Id, name: r.SalesChannelName || r.Id })) };
  }

  return { consoleData, filterOptions, routes: [['/api/console', (m, q) => consoleData(q('range'), scopeOf(q))], ['/api/filters', () => filterOptions()]] };
}
