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
// The console's sample data (?demo=1): every view's payload, in the shapes the read model (om-core*.js) answers, built
// with a fixed seed so a reload shows the same org. A new panel needs matching fields here (demoData, demoDash, demoExtra).
import { STATES } from './console-geo.js';
import { buckets } from './console-charts.js';

// What the console has on screen (index.html sets it), so a drawer opened from the stream matches it: the console payload, or
// null before one has loaded.
export const demoPage = { data: () => null };

export const DEMO_PRODUCTS = [['Trail Runner 2 · Blue 10','NW-4471','NW-4471-BL-10','Footwear'],['Trail Runner 2 · Black 9','NW-4472','NW-4472-BK-09','Footwear'],['Merino Base Layer · M','NW-2210','NW-2210-M','Apparel'],['Down Parka · L','NW-3301','NW-3301-L','Apparel'],['Camp Mug','NW-0914','NW-0914','Gear'],['Headlamp 400','NW-1180','NW-1180','Gear'],['Energy Drink · 12 pack','BV-6010','6010013-12','Beverage'],['Water Bottle 1L','NW-0920','NW-0920','Gear']].map(([Name, ProductCode, StockKeepingUnit, Family], i) => ({ Id: 'DP' + String(i).padStart(13, '0'), Name, ProductCode, StockKeepingUnit, Family, IsActive: true }));
// ---------- sample data (?demo=1) ----------
// Sample customers by city: a few real cities per demand state, plus one unlisted town so the "other cities" pool shows.
export function demoCustGeo(demand) {
  const pickC = (a) => (globalThis.US_CITIES?.[a] || '').split('|').slice(0, 3).map((e) => e.split(' ').slice(0, -2).join(' ')).filter(Boolean);
  let q = 0;
  const cities = demand.flatMap((d, i) => [...pickC(d.key), ...(i === 2 ? ['Fernwood Hollow'] : [])].map((city, k) => {
    const n = Math.max(1, Math.round(d.n * .45 / (k + 1.5))), top = [0, 1, 2].slice(0, Math.min(3, n)).map((t) => { const x = (q + t * 5) % DEMO_ACCTS.length; return { id: 'DACC' + String(x).padStart(11, '0'), name: DEMO_ACCTS[x], orders: Math.max(1, Math.round(n * 1.8 / (t + 1))), spend: Math.round(n * 160 / (t + 1)) }; });
    q++;
    return { state: d.key, city, n, orders: Math.round(n * 2.2), spend: Math.round(n * (150 + (i % 4) * 30)), top };
  }));
  const states = demand.map((d) => { const c = cities.filter((x) => x.state === d.key); return { key: d.key, n: c.reduce((s, x) => s + x.n, 0), orders: c.reduce((s, x) => s + x.orders, 0), spend: c.reduce((s, x) => s + x.spend, 0) }; });
  return { states, cities };
}
// The sample org's policies, in policyBook()'s shape (om-core.js): a default of each kind, and a longer return window one store uses.
export function demoPolicies() {
  return { available: true, state: 'ok', at: new Date().toISOString(),
    return: [{ id: 'DRP000000000001', kind: 'return', name: 'Standard returns: 30 days', isDefault: true, enforce: 'block', days: 30, from: 'delivery', description: 'Items can be returned within 30 days of delivery.' },
      { id: 'DRP000000000002', kind: 'return', name: 'Extended returns: 60 days', isDefault: false, enforce: 'block', days: 60, from: 'delivery', description: 'Items can be returned within 60 days of delivery.' }],
    cancel: [{ id: 'DCP000000000001', kind: 'cancel', name: 'Cancel within 24 hours', isDefault: true, enforce: 'warn', hours: 24, description: 'An order can be cancelled within 24 hours of being placed.' }],
    adjust: [{ id: 'DAP000000000001', kind: 'adjust', name: 'Agent discounts: 20% or $50', isDefault: true, enforce: 'block', maxPercent: 20, maxAmount: 50, description: 'Up to 20% or $50 off an order, all discounts together, whichever is less.' }],
    assignments: [{ id: 'DPA000000000001', storeId: 'D0ZE00000000001', store: 'Northwind Store', return: 'DRP000000000002', cancel: null, adjust: null }] };
}
// The sample numbers below were written for 90 days. A shorter or longer range scales them, so the range buttons change what
// the page shows, as they do against an org: orders and money with the days; open exceptions (a backlog, not a flow) with
// their square root; Waiting and Stuck are right-now counts and stay as they are. Every list is as long as the number above it
// (capped at 50 a stream tab), so the 90-day payload has the older panels' numbers but longer exception and stream lists.
// OM Service Console's demo reads the first 30 orders of the stream, so it doesn't change with the Console's.
// The sample org's stores and sales channels for the Store and Sales channel filters (/api/filters), each with its share of the
// orders: a filtered view scales its flows by the share, and the order stream keeps only its channel's orders.
export const DEMO_STORES = [['DWS000000000001', 'Northwind Outdoors', .6], ['DWS000000000002', 'Northwind B2B', .25], ['DWS000000000003', 'Northwind Beverages', .15]];
export const DEMO_CHANNELS = [['DSC000000000001', 'Web', .4], ['DSC000000000002', 'Store', .2], ['DSC000000000003', 'B2B', .2], ['DSC000000000004', 'Shopper Agent', .2]];
export const demoFilters = () => ({ stores: DEMO_STORES.map(([id, name]) => ({ id, name })), channels: DEMO_CHANNELS.map(([id, name]) => ({ id, name })) });
const picked = (list, id) => (id ? list.find(([x]) => x === id) : null);
export const scopeShare = (scope) => (picked(DEMO_STORES, scope?.store)?.[2] ?? 1) * (picked(DEMO_CHANNELS, scope?.channel)?.[2] ?? 1);
const scopeOut = (scope) => ({ store: picked(DEMO_STORES, scope?.store)?.[0] ?? null, channel: picked(DEMO_CHANNELS, scope?.channel)?.[0] ?? null });
const RANGE_DAYS = { today: 1, '7d': 7, '30d': 30, '90d': 90, '6m': 182, '1y': 365, all: 365 };
const rangeScale = (r) => (RANGE_DAYS[r] ?? 90) / 90;
// Whole numbers in the proportions of `parts` (their `n`) that add up to `total` (largest remainder), so a board still sums to its KPI.
function share(parts, total) {
  const sum = parts.reduce((a, x) => a + x.n, 0) || 1, raw = parts.map((x) => (x.n * total) / sum), out = raw.map(Math.floor);
  let left = total - out.reduce((a, n) => a + n, 0);
  raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left-- > 0) out[i]++; });
  return parts.map((x, i) => ({ ...x, n: out[i] }));
}

export function demoData(r = '90d', scope = null) {
  const rnd = ((s) => () => (s = (s * 16807) % 2147483647) / 2147483647)(42);
  const st = ['TX','NY','CA','FL','IL','GA','WA','PA','OH','NC','NJ','AZ','CO','MA','MI','VA','TN','MN','OR','NV'];
  const cats = ['Fulfillment','Payment','Order','Invoice'];
  const now = Date.now();
  const k = rangeScale(r) * scopeShare(scope), kx = Math.sqrt(k), exOpen = Math.round(26 * kx), returns = Math.round(312 * k * .06), orders = Math.round(312 * k);
  // The activity stream lists what was updated in the range, newest first, as a real org does: as many orders as the range has
  // (at most the 50 a panel holds), and each other tab in proportion. `pool` is all the sample orders; the first 30 are the ones the
  // sample data always had, so what they draw from `rnd` is unchanged. The 20 after them use a generator of their own.
  const rndPool = ((s) => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
  const orderRow = (i, rnd) => ({ Id: 'DEMO' + String(i).padStart(11, '0'), OrderNumber: '000' + (4210 - i), Status: ['Created','Approved','Fulfilled','Fulfilled','Waiting to Fulfill','Cancelled'][i % 6], GrandTotalAmount: Math.round(60 + rnd() * 420), LastModifiedDate: new Date(now - i * 7 * 60000).toISOString(), OrderedDate: new Date(now - i * 9 * 60000).toISOString(), AccountId: 'DACC' + String(i % 5).padStart(11, '0'), Account: { Name: ['Avery Chen','Northwind B2B','Jordan Diaz','Sam Patel','Riley Brooks'][i % 5] }, SalesChannel: { SalesChannelName: ['Web','Web','Store','B2B','Shopper Agent'][i % 5] } });
  const channel = picked(DEMO_CHANNELS, scope?.channel)?.[1];
  const pool = Array.from({ length: 50 }, (_, i) => orderRow(i, i < 30 ? rnd : rndPool)).filter((o) => !channel || o.SalesChannel.SalesChannelName === channel);
  const inRange = (base) => Math.min(50, Math.max(1, Math.round(base * k)));
  const stream = pool.slice(0, Math.min(50, orders));
  const network = [['Reno DC','Warehouse',39.5,-119.8,1000,640,'NV'],['Dallas DC','Warehouse',32.8,-96.8,1200,1080,'TX'],['Columbus DC','Warehouse',39.96,-83,900,610,'OH'],['Atlanta DC','Warehouse',33.75,-84.39,800,560,'GA'],['Edison DC','Warehouse',40.5,-74.4,1000,930,'NJ'],['Seattle store hub','Store',47.6,-122.3,200,90,'WA'],['Chicago store hub','Store',41.88,-87.63,200,150,'IL']].map(([name,type,lat,lon,cap,assigned,state], i) => ({ id: 'L' + i, name, type, lat, lon, cap, assigned, openFOs: Math.round(assigned / 8), city: name.split(' ')[0], state }));
  const demand = st.map((s, i) => ({ key: s, n: Math.round(90 / (i + 1) + rnd() * 10) })).map((d) => ({ ...d, n: Math.round(d.n * k) })).filter((d) => d.n > 0);
  const nearest = (s) => { const [, la, lo] = STATES[s]; return [...network].sort((a, b) => Math.hypot(a.lat - la, a.lon - lo) - Math.hypot(b.lat - la, b.lon - lo)); };
  const flows = demand.flatMap((d) => { const [a, b] = nearest(d.key); return [{ loc: a.id, state: d.key, n: Math.round(d.n * .75) }, { loc: b.id, state: d.key, n: Math.max(1, Math.round(d.n * .25)) }]; });
  return { range: r, scope: scopeOut(scope), at: new Date().toISOString(), objects: { OrderSummary: true, FulfillmentOrder: true, ProcessException: true, Location: true, Agent_Proposal__c: true, ReturnOrder: true, Shipment: true, Case: true },
    cases: { ok: true, data: { paths: ['Order_Summary__r.OriginalOrder.ShippingState', 'Order_Summary__r.BillingState', 'Account.BillingState'], via: Object.fromEntries(Object.entries({ 'Order_Summary__r.OriginalOrder.ShippingState': 41, 'Order_Summary__r.BillingState': 12, 'Account.BillingState': 9, '(no state)': 3 }).map(([p, n]) => [p, Math.round(n * k)])), newest: null,
      list: [['CA',14],['TX',11],['NY',9],['FL',7],['IL',5],['WA',4],['GA',4],['MA',3],['CO',3],['(blank)',3]].map(([key, n], i) => [key, Math.round(n * k), i]).filter(([, n]) => n > 0).map(([key, n, i]) => ({ key, n, open: Math.ceil(n * (.3 + (i % 3) * .15)), closed: n - Math.ceil(n * (.3 + (i % 3) * .15)), origin: { [['Web','Phone','Email','Chat'][i % 4]]: Math.ceil(n * .6), Email: Math.floor(n * .4) }, type: { [['Delivery','Return','Billing','Product'][i % 4]]: Math.ceil(n * .7), Question: Math.floor(n * .3) } })) } },
    kpis: { ok: true, data: { orders, value: Math.round(58210 * k), openExceptions: exOpen, waiting: 9, stuck: 4, paymentHolds: Math.min(exOpen, Math.round(3 * kx)), returns, returnValue: returns * 92 } },
    statusBoard: { ok: true, data: { orders: share([{ key:'Created',n:88 },{ key:'Approved',n:61 },{ key:'Fulfilled',n:139 },{ key:'Cancelled',n:24 }], Math.round(312 * k)), fulfillment: share([{ key:'Allocated',n:52 },{ key:'Pickpack',n:79 },{ key:'Fulfilled',n:131 },{ key:'Cancelled',n:6 }], Math.round(268 * k)) } },
    network: { ok: true, data: network }, demand: { ok: true, data: demand }, flows: { ok: true, data: flows },
    customers: { ok: true, data: demoCustGeo(demand) },
    exByState: { ok: true, data: share([['TX',7],['NY',5],['CA',4],['FL',3],['NJ',3],['IL',2],['GA',2]].map(([key, n]) => ({ key, n })), exOpen).filter((x) => x.n > 0) },
    exceptions: { ok: true, data: Array.from({ length: exOpen }, (_, i) => ({ Id: 'PE' + i, ProcessExceptionNumber: 'PE-' + String(27300 - i).padStart(8, '0'), Category: cats[i % 4], Status: i % 3 ? 'New' : 'Triaged', Severity: ['High','Medium','Low'][i % 3], Message: ['Allocation failed: no ATP at Dallas DC for NW-4471','Payment capture declined (insufficient funds)','Order stuck in Created > 2h','Invoice ensure-funds failed'][i % 4], OrderSummaryId: pool[i % pool.length].Id, OrderSummary: { OrderNumber: pool[i % pool.length].OrderNumber }, CreatedDate: new Date(now - i * 23 * 60000).toISOString() })) },
    stream: { ok: true, data: stream }, orderPool: pool,
    foStream: { ok: true, data: pool.slice(0, inRange(24)).map((o, i) => ({ Id: 'DFO' + i, FulfillmentOrderNumber: 'FO-' + (8830 - i), Status: ['Allocated','Pickpack','Fulfilled','Fulfilled','Assigned','Rejected'][i % 6], FulfilledFromLocation: { Name: ['Dallas DC','Reno DC','Columbus DC','Store 114 · Austin'][i % 4] }, FulfilledToName: o.Account.Name, FulfilledToCity: ['Seattle','Denver','Chicago','Atlanta','Boston'][i % 5], FulfilledToState: ['WA','CO','IL','GA','MA'][i % 5], OrderSummaryId: o.Id, OrderSummary: { OrderNumber: o.OrderNumber }, LastModifiedDate: new Date(now - i * 11 * 60000).toISOString() })) },
    shStream: { ok: true, data: pool.slice(0, inRange(18)).map((o, i) => ({ Id: 'DSH' + i, ShipmentNumber: 'SHP-' + (5120 - i), Status: ['Shipped','In Transit','Delivered','Delivered','Out for Delivery'][i % 5], Provider: ['UPS','FedEx','USPS'][i % 3], TrackingNumber: '1Z' + String(90412 + i * 37).padStart(8, '0'), ShipToName: o.Account.Name, ShipToCity: ['Seattle','Denver','Chicago','Atlanta','Boston'][i % 5], ShipToState: ['WA','CO','IL','GA','MA'][i % 5], ExpectedDeliveryDate: new Date(now + (i % 4) * 864e5).toISOString(), ActualDeliveryDate: i % 5 === 2 || i % 5 === 3 ? new Date(now - i * 3600e3).toISOString() : null, OrderSummaryId: o.Id, OrderSummary: { OrderNumber: o.OrderNumber }, LastModifiedDate: new Date(now - i * 17 * 60000).toISOString() })) },
    caseStream: { ok: true, data: pool.slice(0, inRange(10)).map((o, i) => ({ Id: 'DCS' + i, CaseNumber: String(1042 - i).padStart(8, '0'), Status: ['New','Working','Escalated','Closed','Waiting on Customer'][i % 5], Priority: ['High','Medium','Low'][i % 3], Type: ['Shipping Delay','Order Status','Return','Cancellation'][i % 4], Origin: ['Proactive','Email','Phone','Web'][i % 4], Subject: ['Shipment is late','Where is my order?','Return label request','Cancel before shipping','Wrong item received'][i % 5], Account: o.Account, OrderSummaryId: o.Id, OrderSummary: { OrderNumber: o.OrderNumber }, LastModifiedDate: new Date(now - i * 37 * 60000).toISOString() })) },
    roStream: { ok: true, data: pool.slice(0, Math.min(50, returns)).map((o, i) => ({ Id: 'DRO' + i, ReturnOrderNumber: 'RO-' + (310 - i), Status: ['Submitted','Received','Closed','Pending Exchange'][i % 4], GrandTotalAmount: Math.round(o.GrandTotalAmount * 0.4), Account: o.Account, OrderSummaryId: o.Id, OrderSummary: { OrderNumber: o.OrderNumber }, LastModifiedDate: new Date(now - i * 53 * 60000).toISOString() })) } };
}
export function demoInventory(p, range) {
  const i = DEMO_PRODUCTS.indexOf(p), rnd = ((s) => () => (s = (s * 16807) % 2147483647) / 2147483647)((i + 1) * 104729 + 7919), net = demoData().network.data; rnd(); rnd();
  const tried = [{ source: 'ProductItem', note: 'not available in this org' }];
  if (p.ProductCode === 'NW-0914') { // no OCI records: the Orders fallback path
    tried.push({ source: 'Omnichannel Inventory', note: `no inventory records for SKU ${p.StockKeepingUnit} at 8 synced locations` });
    const locations = net.filter(() => rnd() > .4).map((l) => ({ id: l.id, name: l.name, qty: Math.round(4 + rnd() * 30) })).sort((a, b) => b.qty - a.qty);
    return { product: p, source: 'Orders', measure: 'Units fulfilled', locations, states: ['CA','TX','WA','CO','OR','NY','IL'].map((key, k) => ({ key, n: Math.round(40 / (k + 1) + rnd() * 6) })), tried, range, stateBasis: 'FO ship-to state', available: true };
  }
  const shape = (q) => ({ qty: q, atf: q, onHand: Math.round(q * 1.12), reserved: Math.round(q * .08), ato: Math.round(q * 1.05), inTransit: Math.round(rnd() * 40) });
  const locations = [...net.filter(() => rnd() > .25).map((l) => ({ id: l.id, name: l.name, ref: l.name.toUpperCase().replace(/\W+/g, '-'), ...shape(Math.round(20 + rnd() * 900)) })), { id: null, name: 'Marketplace virtual pool', ref: 'VIRTUAL-MKT', ...shape(Math.round(50 + rnd() * 200)) }].sort((a, b) => b.qty - a.qty);
  const tot = locations.reduce((s, l) => s + l.qty, 0);
  return { product: p, source: 'Omnichannel Inventory', measure: 'Available to fulfill', locations, states: [], tried, range, checked: 8, groups: [{ name: 'Web storefront', ref: 'WEB', ...shape(Math.round(tot * .8)) }, { name: 'Marketplace', ref: 'MKT', ...shape(Math.round(tot * .1)) }] };
}
export function demoDash(p, scope = null) {
  if (!['today', 'mtd', 'qtd', 'ytd', '6m', '1y', 'all'].includes(p)) p = 'mtd';
  const rnd = ((s) => () => (s = (s * 16807) % 2147483647) / 2147483647)(p.length * 97 + 7);
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const from = { today: new Date(y, m, now.getDate()), mtd: new Date(y, m, 1), qtd: new Date(y, m - (m % 3), 1), ytd: new Date(y, 0, 1), '6m': new Date(y, m - 6, now.getDate()), '1y': new Date(y - 1, m, now.getDate()), all: null }[p];
  const grain = p === 'today' ? 'hour' : p === 'mtd' || p === 'qtd' ? 'day' : 'month';
  const scale = { today: 1, mtd: 28, qtd: 80, ytd: 270, '6m': 182, '1y': 365, all: 1400 }[p] * 42 * scopeShare(scope), channel = picked(DEMO_CHANNELS, scope?.channel)?.[1];
  const allFrom = new Date(y - 3, m, 1);
  // The chart and its KPI count the same records, including at the beginning of a month or year.
  const series = (total) => share(buckets([], grain, (from || allFrom).toISOString()).map((x) => ({ key: x.key, n: 0.6 + rnd() * 0.8 })), total);
  const pair = (c) => ({ cur: Math.round(c), prev: from ? Math.round(c * (0.8 + rnd() * 0.35)) : null });
  const o = pair(scale), v = { cur: o.cur * 168, prev: o.prev == null ? null : o.prev * 161 };
  const r = pair(scale * 0.074);
  // Match dashboardReads' calendar periods and cap the prior period at the same elapsed time.
  const prevFrom = from && { today: new Date(y, m, now.getDate() - 1), mtd: new Date(y, m - 1, 1), qtd: new Date(y, m - (m % 3) - 3, 1), ytd: new Date(y - 1, 0, 1), '6m': new Date(y, m - 12, now.getDate()), '1y': new Date(y - 2, m, now.getDate()) }[p];
  const prevTo = prevFrom && new Date(Math.min(+prevFrom + (now - from), +from));
  return { period: p, scope: scopeOut(scope), grain, from: from && from.toISOString(), to: now.toISOString(), prevFrom: prevFrom && prevFrom.toISOString(), prevTo: prevTo && prevTo.toISOString(),
    tiles: { ok: true, data: { orders: o, value: v, returns: r, returnValue: { cur: r.cur * 92, prev: r.prev && r.prev * 92 }, exceptions: pair(scale * 0.06), refunds: pair(scale * 6.1), refundCount: pair(scale * 0.05), fos: pair(scale * 1.2) } },
    ordersSeries: { ok: true, data: series(o.cur) }, returnsSeries: { ok: true, data: series(r.cur) },
    channels: { ok: true, data: channel ? [{ key: channel, n: o.cur }] : share([['Web', .58], ['Mobile app', .24], ['Stores (BOPIS)', .12], ['Marketplace', .06]].map(([key, n]) => ({ key, n })), o.cur) },
    exCategory: { ok: true, data: share([['Fulfillment', .41], ['Payment', .27], ['Order', .19], ['Invoice', .13]].map(([key, n]) => ({ key, n })), Math.round(scale * .06)) },
    exStatus: { ok: true, data: share([['Resolved', .71], ['New', .14], ['Triaged', .1], ['Paused', .05]].map(([key, n]) => ({ key, n })), Math.round(scale * .06)) },
    foStatus: { ok: true, data: share([['Fulfilled', .78], ['Pickpack', .1], ['Allocated', .08], ['Cancelled', .04]].map(([key, n]) => ({ key, n })), Math.round(scale * 1.2)) },
    foMix: { ok: true, data: share([['Warehouse', .66], ['Store', .29], ['Dropship Vendor', .05]].map(([key, n]) => ({ key, n })), Math.round(scale * 1.2)) },
    ...demoExtra(o, v, r, scale, from, rnd),
    customers: demoCustomers(o, v, from),
    ...demoProducts(o, from),
    retStatus: { ok: true, data: share([['Closed', .74], ['Submitted', .17], ['Approved', .06], ['Canceled', .03]].map(([key, n]) => ({ key, n })), r.cur) },
    retReasons: { ok: true, data: [['Size or fit', .31], ['Damaged', .22], ['Not as described', .17], ['Changed mind', .15], ['Wrong item', .09], ['Defective', .06]].map(([key, f]) => ({ key, n: Math.round(r.cur * 1.3 * f) })) },
    retProducts: { ok: true, data: [['Trail runner NW-2210', .19], ['Rain shell NW-4471', .12], ['Merino base layer NW-1180', .09], ['Daypack 22L NW-3302', .06], ['Camp mug NW-0914', .03]].map(([key, f]) => ({ key, n: Math.round(r.cur * 1.3 * f) })) },
    sources: [], at: now.toISOString() };
}
// Sample Agentforce replies for ?demo=1: a brief, an exception answer, a dashboard "why", a decline, and one guard-banner reply.
export function demoAgent(text, ctx) {
  const t = text.toLowerCase(), f = ctx.fields || {}, n = (k) => (Array.isArray(f[k]) ? f[k].length : 0);
  if (/\b(close|cancel|delete|refund)\b/.test(t)) return { text: "I can't do that. I can only read data here. To close, cancel or refund, open the record in Salesforce.", actions: [], guardHit: false };
  if (/\bupdate\b/.test(t)) return { text: 'Updated the order summary status to **Approved**.', actions: ['OMC_Order_Lookup_UpdateRecordFields'], guardHit: true };
  if (t.startsWith('give me a brief')) return { text: `Here's a quick brief:\n\n- **Loyal customer:** 14 orders in 2 years, mostly online.\n- **Latest order** is ${n('ProcessException') ? `held by ${n('ProcessException')} open exception${n('ProcessException') === 1 ? '' : 's'}` : 'on track'}.\n- ${n('Case') ? `**${n('Case')} open case${n('Case') === 1 ? '' : 's'}** on that order.` : 'No open cases on that order.'}\n- Returns are below average.`, actions: ['OMC_Order_Lookup_GetRecordDetails', 'OMC_Order_Lookup_QueryRecords'], guardHit: false };
  const facts = ctx.facts || [], fact = (re) => facts.filter((x) => re.test(x));
  // What the page gave it: an open fulfillment order's routing (its drawer), a product's stock on the map.
  if (/\b(why|rout|warehouse|location)/.test(t)) { const [won] = fact(/^Its routing: /), [rules] = fact(/^Its routing rules: /); if (won) return { text: `${won.replace(/^Its routing: /, '')}.${rules ? `\n\n${rules.replace(/^Its routing rules: /, 'What decided it: ')}.` : ''}`, actions: [], guardHit: false }; }
  if (/\b(stock|inventory|available|where else)\b/.test(t)) { const [at] = fact(/ by location: /); if (at) return { text: `From the map: ${at.replace(/^.* by location: /, '')}.`, actions: [], guardHit: false }; }
  if (ctx.view === 'dashboard' && !f.panel && /return/.test(t)) { const [sku] = fact(/^Most-returned products: /), [why] = fact(/^Return drivers: /); if (sku || why) return { text: `From the Returns tab:\n\n${[sku, why].filter(Boolean).map((x) => `- **${x.replace(/: /, ':** ')}`).join('\n')}`, actions: [], guardHit: false }; }
  // A breakdown names each group (the agent groups by SalesStore.Name or SalesChannel.SalesChannelName, never by Id).
  if (/\b(web ?store|storefront|sales channel|channel)s?\b/.test(t)) { const ch = /channel/.test(t); return { text: `${ch ? 'Orders by sales channel' : 'Orders by webstore'}, last 30 days (OrderSummary by OrderedDate):\n\n${(ch ? [['Web', 1284], ['Store', 412], ['B2B', 236], ['Shopper Agent', 97]] : [['Northern Trail Outfitters US', 1106], ['NTO Canada', 501], ['NTO Outlet', 186]]).map(([n, c]) => `- **${n}:** ${c.toLocaleString('en-US')}`).join('\n')}`, actions: ['OMC_Analysis_QueryRecordsWithAggregate'], guardHit: false }; }
  if (ctx.view === 'dashboard') return { text: `${f.panel ? `**${f.panel}**` : 'This number'} moved mainly because of a jump in online orders in the second week, with store pickups flat.\n\n- Online: +18%\n- Pickup: +1%\n- Ship from store: −4%`, actions: ['OMC_Analysis_QueryRecordsWithAggregate'], guardHit: false };
  if (ctx.view === 'console' && /exception/.test(t)) { const [cats] = fact(/listed on screen, by category/), [states] = fact(/^Open exceptions by ship-to state/); if (cats) return { text: `${cats}.${states ? `\n\n${states}.` : ''}\n\nExceptions aren't tied to a location in this org, so the ship-to state is the nearest view.`, actions: [], guardHit: false }; }
  if (ctx.view === 'console' && /location|behind|capacity/.test(t)) { const ls = fact(/^Location /).slice(0, 3); if (ls.length) return { text: `The busiest locations right now:\n\n${ls.map((x) => `- ${x.replace(/^Location /, '')}`).join('\n')}\n\nThe first is furthest behind; check its allocation queue.`, actions: [], guardHit: false }; }
  if (/stuck|exception|attention|behind/.test(t)) return { text: `The main blocker on [Order 0004207](OrderSummary/DEMO00000000003) is a **payment authorization** that failed and wasn't retried.\n\n- 1 fulfillment order is waiting on allocation.\n- The other ships today.\n\nCheck the payment gateway log first.`, actions: ['OMC_Order_Lookup_QueryRecords'], guardHit: false };
  return { text: "Here's what I found: nothing unusual in the last 24 hours. Ask about a specific order, location or number for more.", actions: ['OMC_Order_Lookup_QueryRecords'], guardHit: false };
}
export function demoExtra(o, v, r, scale, from, rnd) {
  const ok = (data) => ({ ok: true, data }), pv = (x) => (from ? x * (0.9 + rnd() * 0.2) : null);
  const fos = Math.round(scale * 1.2), H = ['< 1 h', '1–4 h', '4–24 h', '1–3 d', '3–7 d', '7 d +'], D = ['0–7 d', '8–14 d', '15–30 d', '31–60 d', '61–90 d', '90 d +'], A = ['< 1 d', '1–3 d', '3–7 d', '7–30 d', '30–90 d', '90 d +'];
  const hist = (keys, fr, n) => share(keys.map((key, i) => ({ key, n: fr[i] })), Math.round(n));
  const locs = [['Dallas DC', 'Warehouse', .24, .01], ['Reno DC', 'Warehouse', .19, .015], ['Columbus DC', 'Warehouse', .16, .02], ['Edison DC', 'Warehouse', .14, .012], ['Atlanta DC', 'Warehouse', .11, .03], ['Store 114 · Austin', 'Store', .06, .09], ['Store 208 · Chicago', 'Store', .05, .12], ['Store 031 · Seattle', 'Store', .05, .07]];
  const qo = Math.round(o.cur * 2.3), qc = Math.round(qo * 0.041), qr = Math.round(qo * 0.068), amt = qo * 71;
  const line = (m) => ({ qo: qo * m, qc: qc * m, qr: qr * m, adj: -amt * 0.064 * m, amt: amt * m, l: Math.round(o.cur * 1.8 * m), o: o.cur * m });
  return {
    objects: { OrderSummary: true, FulfillmentOrder: true, ProcessException: true, ReturnOrder: true, CreditMemo: true, OrderItemSummary: true, OrderItemSummaryChange: true, PaymentAuthorization: true, Payment: true, Invoice: true, Refund: true, Case: true, Shipment: true, LocationGroupAssignment: true },
    speed: ok({ rows: Math.min(2000, fos), capped: fos > 2000, route: { n: Math.min(2000, fos), p50: 0.4, p90: 5.5, hist: hist(H, [.58, .24, .12, .04, .015, .005], Math.min(2000, fos)) }, close: { n: Math.round(Math.min(2000, fos) * .82), p50: 26, p90: 71, hist: hist(H, [.02, .08, .33, .44, .1, .03], Math.min(2000, fos) * .82) },
      routeByLoc: Object.fromEntries(locs.map(([n], i) => [n, 0.2 + i * 0.15])), openAge: hist(A, [.52, .27, .12, .06, .02, .01], 146) }),
    locations: ok(locs.map(([name, type, f, rj]) => { const total = Math.round(fos * f), rejected = Math.round(total * rj), cancelled = Math.round(total * .02), open = Math.round(total * .07); return { name, type, total, fulfilled: total - rejected - cancelled - open, rejected, cancelled, open }; })),
    locGroups: ok([['West region', 3, .30], ['Central region', 3, .45], ['East region', 2, .25], ['Ship-from-store', 3, .16]].map(([key, locations, f]) => ({ key, locations, n: Math.round(fos * f) }))),
    carriers: ok({ total: Math.round(fos * .9), withActual: Math.round(fos * .72), list: [['UPS', .46, .93, 2.4], ['FedEx', .31, .9, 2.1], ['USPS', .19, .86, 3.3], ['OnTrac', .04, .95, 1.6]].map(([key, f, on, tr]) => { const n = Math.round(fos * .9 * f), delivered = Math.round(n * .8); return { key, n, delivered, measured: delivered, onTime: Math.round(delivered * on), transitP50: tr, status: { Delivered: delivered, 'In Transit': Math.round(n * .15), Shipped: n - delivered - Math.round(n * .15) } }; }) }),
    money: ok({ auth: { Processed: { c: o.cur, a: v.cur }, Failed: { c: Math.round(o.cur * .01), a: v.cur * .01 } }, pay: { Processed: { c: Math.round(o.cur * .94), a: v.cur * .86 }, Failed: { c: Math.round(o.cur * .004), a: v.cur * .004 } },
      inv: { c: Math.round(o.cur * .93), a: v.cur * .88, b: v.cur * .03 }, ref: { Processed: { c: Math.round(r.cur * .9), a: v.cur * .041 } }, objects: { PaymentAuthorization: true, Payment: true, Invoice: true, Refund: true } }),
    settlement: ok((() => {
      const at = (dd) => new Date(Date.now() - dd * 864e5).toISOString();
      // Link to the same sample orders the drawer and history open, with distinct records on the two lists.
      const pool = demoData().orderPool;
      const open = (n, rows) => ({ orders: n, docs: Math.round(n * 1.15), amount: rows.reduce((s, x) => s + x[2], 0) * n / rows.length,
        top: rows.map(([index, total, balance, dd]) => ({ id: pool[index].Id, number: pool[index].OrderNumber, status: pool[index].Status, docs: 1, total, balance, at: at(dd) })) });
      return { unpaid: open(Math.round(o.cur * .012) + 3, [[2, 1240, 1240, 2], [3, 860, 412.5, 4], [8, 389, 389, 6], [9, 212.4, 112.4, 9]]),
        unrefunded: open(Math.round(r.cur * .03) + 2, [[5, 249, 249, 1], [11, 129, 129, 3], [14, 68, 68, 8]]),
        noInvoice: Math.round(o.cur * .004) + 1, objects: { Invoice: true, CreditMemo: true } };
    })()),
    lines: ok({ cur: line(1), prev: from ? line(0.92) : null }),
    cancelled: ok({ value: qc * 68, capped: false, products: [['Rain shell NW-4471', .22], ['Trail runner NW-2210', .17], ['Down vest NW-5520', .12], ['Merino base layer NW-1180', .09], ['Daypack 22L NW-3302', .06]].map(([key, f]) => ({ key, n: Math.round(qc * f), v: Math.round(qc * f * 92) })) }),
    cancelReasons: ok([['Out of stock', .34], ['Customer request', .29], ['Payment declined', .15], ['Fraud review', .09], ['Delivery too slow', .07]].map(([key, f]) => ({ key, n: Math.round(qc * .7 * f) }))),
    cancelWhen: ok([{ key: true, n: Math.round(qc * .62) }, { key: false, n: Math.round(qc * .08) }]),
    changes: ok([['Return', .52], ['Cancel', .31], ['Add', .1], ['Price Adjustment', .07]].map(([key, f]) => ({ key, n: Math.round((qc + qr) * f) }))),
    exAge: ok(hist(A, [.46, .25, .15, .09, .04, .01], 44)),
    exResolve: ok({ n: Math.round(scale * .043), p50: 3.2, p90: 30, byCategory: [['Fulfillment', 2.1], ['Payment', 5.8], ['Order', 1.3], ['Invoice', 9.5]].map(([key, h], i) => ({ key, n: h, count: Math.round(scale * .043 * [.41, .27, .19, .13][i]) })) }),
    cases: ok({ count: { cur: Math.round(o.cur * .06), prev: pv(Math.round(o.cur * .06)) && Math.round(pv(o.cur * .06)) }, type: [['Where is my order', .38], ['Return or exchange', .27], ['Damaged item', .14], ['Billing', .12], ['(blank)', .09]].map(([key, f]) => ({ key, n: Math.round(o.cur * .06 * f) })),
      status: [['Closed', .71], ['Working', .17], ['New', .12]].map(([key, f]) => ({ key, n: Math.round(o.cur * .06 * f) })), origin: [['Web', .46], ['Phone', .31], ['Email', .17], ['Chat', .06]].map(([key, f]) => ({ key, n: Math.round(o.cur * .06 * f) })), close: { n: Math.round(o.cur * .043), p50: 19 } }),
    retDays: ok({ n: r.cur, p50: 9.4, p90: 27, hist: hist(D, [.34, .31, .24, .08, .02, .01], r.cur) }),
    retByChannel: ok([['Web', .58, .071], ['Mobile app', .24, .064], ['Stores (BOPIS)', .12, .038], ['Marketplace', .06, .092]].map(([key, f, rt]) => ({ key, ordered: Math.round(qo * f), returned: Math.round(qo * f * rt) }))),
    retByProduct: ok([['Trail runner NW-2210', 900, .16], ['Rain shell NW-4471', 700, .12], ['Merino base layer NW-1180', 1100, .07], ['Daypack 22L NW-3302', 600, .06], ['Camp mug NW-0914', 1500, .02]].map(([key, n, rt]) => ({ key, ordered: Math.round(n * scale / 3000), returned: Math.round(n * scale / 3000 * rt) }))),
    retOutcome: ok({ repay: [['Refund to original payment', .71], ['Exchange', .2], ['Store credit', .09]].map(([key, f]) => ({ key, n: Math.round(qr * f) })), plan: [['Return to stock', .64], ['Inspect', .24], ['Dispose', .12]].map(([key, f]) => ({ key, n: Math.round(qr * f) })), exchanges: Math.round(r.cur * .2), refunds: { c: Math.round(r.cur * .78), a: v.cur * .041 } }),
  };
}
// One order's history for the Activity and Timeline tabs: split fulfillment, a failed store, an exception, two shipments, a case and a return.
export const DEMO_ITEMS = [['p1', 'Trail runner 2', 1, 189], ['p2', 'Packable rain shell', 1, 129], ['p3', 'Merino crew socks', 2, 58], ['p4', 'Trail cap', 1, 29, 1],
  ['p5', 'Summit camp kit', 1, 249], ['p6', 'Trailhead 2 tent', 1, 0, 0, 'p5'], ['p7', 'Fuel canister', 2, 0, 0, 'p5']]; // a bundle: its parts name it (MainOrderItemSummaryId)
export function demoHistory(id) {
  const src = demoPage.data() || demoData(), o = (src.orderPool || src.stream.data).find((r) => r.Id === id) || src.stream.data[0] || src.orderPool[0];
  const base = new Date(); base.setHours(0, 0, 0, 0); base.setDate(base.getDate() - 8);
  const T = (day, h, m = 0) => new Date(+base + day * 864e5 + (h * 60 + m) * 60e3).toISOString();
  const P = (...l) => l.map((k) => ({ key: k, qty: k === 'p3' ? 2 : 1 }));
  const E = (id, obj, lane, ref, title, status, tone, start, end, amount, products = [], rel = [], sub) => ({ id, obj, lane, ref, title, sub, status, tone, start, end, amount, products, rel });
  const events = [
    E(o.Id, 'OrderSummary', 'order', o.OrderNumber, 'Order placed', o.Status, 'done', T(0, 9, 14), T(0, 9, 14), 441.8, P('p1', 'p2', 'p3', 'p4')),
    E('dPA1', null, 'money', 'PA-0091', 'Payment authorized', 'Processed', 'done', T(0, 9, 15), T(0, 9, 15), 441.8),
    E('dFO1', 'FulfillmentOrder', 'fo', 'FO-1', 'Fulfilled from Reno DC', 'Fulfilled', 'done', T(0, 9, 40), T(1, 15, 20), 247, P('p1', 'p3'), ['dSH1']),
    E('dFO2', 'FulfillmentOrder', 'fo', 'FO-2', 'Fulfilled from Denver store', 'Cancelled', 'fail', T(0, 9, 40), T(0, 13, 5), 129, P('p2'), ['dPE1']),
    E('dCO1', null, 'change', 'CO-1', 'Items cancelled', 'Cancel', 'done', T(0, 10, 2), T(0, 10, 2), -29, P('p4'), [], 'Customer request'),
    E('dPE1', 'ProcessException', 'exc', 'PE-1', 'Inventory short', 'Resolved', 'done', T(0, 12, 50), T(0, 13, 30), null, P('p2'), ['dFO2', 'dFO3'], 'High'),
    E('dFO3', 'FulfillmentOrder', 'fo', 'FO-3', 'Fulfilled from Columbus DC', 'Fulfilled', 'done', T(0, 13, 10), T(2, 11, 0), 129, P('p2'), ['dPE1', 'dSH2']),
    E('dSH1', 'Shipment', 'ship', 'SH-1', 'Shipped with UPS', 'Delivered', 'done', T(1, 15, 30), T(3, 14, 10), null, P('p1', 'p3'), ['dFO1']),
    E('dIN1', null, 'money', 'INV-1', 'Invoiced', 'Posted', 'done', T(1, 15, 35), T(1, 15, 35), 268.4),
    E('dSH2', 'Shipment', 'ship', 'SH-2', 'Shipped with FedEx', 'Delivered', 'done', T(2, 11, 20), T(4, 10, 45), null, P('p2'), ['dFO3', 'dCS1']),
    E('dIN2', null, 'money', 'INV-2', 'Invoiced', 'Posted', 'done', T(2, 11, 25), T(2, 11, 25), 144.4),
    E('dCS1', 'Case', 'case', '00012345', 'Shipment status', 'Closed', 'done', T(3, 18, 5), T(4, 11, 30), null, [], ['dSH2']),
    E('dRO1', 'ReturnOrder', 'ret', 'RO-1', 'Return', 'Received', 'done', T(5, 10, 0), T(7, 16, 20), 58, P('p3'), ['dCM1']),
    E('dCM1', null, 'money', 'CM-1', 'Credit memo', 'Posted', 'done', T(7, 16, 40), T(7, 16, 40), -58, [], ['dRO1']),
  ];
  return { order: { Id: o.Id, OrderNumber: o.OrderNumber, Status: o.Status }, events,
    products: DEMO_ITEMS.map(([key, name, qty, price, canceled = 0]) => ({ key, name, qty, canceled, price })), at: new Date().toISOString() };
}
export function demoOrder(id) {
  const src = demoPage.data() || demoData();
  const o = (src.orderPool || src.stream.data).find((r) => r.Id === id) || src.stream.data[0] || src.orderPool[0];
  return { order: { ...o, BillingCity: 'Austin', BillingState: 'TX', BillingEmailAddress: 'avery@example.com' }, items: DEMO_ITEMS.map(([Id, Name, Quantity, TotalPrice, QuantityCanceled = 0, MainOrderItemSummaryId = null]) => ({ Id, Name, Quantity, QuantityCanceled, TotalPrice, TypeCode: 'Product', MainOrderItemSummaryId })),
    fulfillmentOrders: [{ Id: (src.foStream.data.find((f) => f.OrderSummaryId === o.Id) || src.foStream.data[0]).Id, FulfillmentOrderNumber: 'FO-0' + o.OrderNumber, FulfilledFromLocationId: 'L1', FulfilledFromLocation: { Name: 'Dallas DC' }, FulfilledToCity: 'Austin', FulfilledToState: 'TX', Status: 'Pickpack' }],
    exceptions: src.exceptions.data.filter((e) => e.OrderSummaryId === o.Id), cases: src.caseStream.data.filter((c) => c.OrderSummaryId === o.Id) };
}
// Products tab sample data, built from DEMO_PRODUCTS so a row click opens the same product on the console map.
export function demoProducts(o, from) {
  const ok = (data) => ({ ok: true, data }), qo = Math.round(o.cur * 2.3), price = [129, 129, 68, 249, 18, 42, 24, 22];
  const mix = [[.21, .03, .11], [.17, .05, .14], [.16, .02, .05], [.08, .09, .07], [.14, .01, .01], [.11, .02, .03], [.12, .06, .004], [.004, .5, .5]];
  const rows = DEMO_PRODUCTS.map((p, i) => { const [f, c, r] = mix[i], n = Math.max(1, Math.round(qo * f)); return { id: p.Id, key: p.Name, fam: p.Family, qo: n, qc: Math.round(n * c), qr: Math.round(n * r), amt: n * price[i] }; }).sort((a, b) => b.qo - a.qo);
  const sum = (k, l = rows) => l.reduce((s, r) => s + r[k], 0), floor = Math.max(5, Math.ceil(sum('qo') * 0.01));
  const rate = (k) => rows.filter((r) => r.qo >= floor && r[k] > 0).map((r) => ({ id: r.id, key: r.key, n: r[k] / r.qo, units: r[k], ordered: r.qo })).sort((a, b) => b.n - a.n).slice(0, 8);
  const tot = (m) => ({ n: rows.length, qo: Math.round(sum('qo') * m), qc: Math.round(sum('qc') * m), qr: Math.round(sum('qr') * m), amt: Math.round(sum('amt') * m) });
  const fams = [...new Set(rows.map((r) => r.fam))].map((key) => { const l = rows.filter((r) => r.fam === key); return { key, products: l.length, qo: sum('qo', l), amt: sum('amt', l) }; }).sort((a, b) => b.qo - a.qo);
  // Open demand is today's snapshot, not the historical product sales selected above.
  const openRows = DEMO_PRODUCTS.map((p, i) => ({ id: p.Id, key: p.Name, qo: Math.round(28 * 42 * 2.3 * mix[i][0]) })).sort((a, b) => b.qo - a.qo);
  const open = openRows.slice(0, 6).map((r, i) => ({ id: r.id, key: r.key, n: Math.max(1, Math.round(r.qo * [.09, .07, .06, .05, .04, .03][i])), fos: Math.max(1, Math.round(r.qo * [.05, .04, .04, .03, .02, .02][i])) })).sort((a, b) => b.n - a.n);
  return {
    prodTotals: ok({ cur: tot(1), prev: from ? { ...tot(0.91), n: rows.length - 1 } : null }),
    prodTop: ok({ top: rows.map(({ fam, ...r }) => r), floor, cancelRate: rate('qc'), returnRate: rate('qr'), products: rows.length, capped: false, revenue: 'TotalLineAmount' }),
    prodRevenue: ok([...rows].sort((a, b) => b.amt - a.amt).map(({ id, key, qo, amt }) => ({ id, key, qo, amt }))),
    prodFamily: ok(fams),
    prodDemand: ok({ units: sum('n', open), products: open.length, fos: Math.round(sum('fos', open) * 0.8), list: open }),
  };
}
// One sample customer per demo account: a loyal big spender, a B2B buyer, a heavy returner, a lapsed shopper and a new one.
export const DEMO_ACCTS = ['Avery Chen', 'Northwind B2B', 'Jordan Diaz', 'Sam Patel', 'Riley Brooks', 'Blue Ridge Outfitters', 'Casey Morgan', 'Taylor Nguyen', 'Jamie Ortiz', 'Quinn Harper', 'Drew Kim', 'Alex Rivera', 'Summit Supply Co', 'Morgan Ellis'];
export function demoCustomers(o, v, from) {
  const n = Math.max(14, Math.round(o.cur / 2.6)), share = [.034, .052, .018, .011, .009, .027, .016, .014, .012, .01, .008, .007, .021, .006];
  const retPer = [.04, .02, .27, .07, .05, .01, .12, .03, .18, 0, .09, .06, .02, .22];
  const all = DEMO_ACCTS.map((name, i) => {
    const spend = Math.round(v.cur * share[i]), orders = Math.max(1, Math.round(o.cur * share[i] * ([1, 5, 12].includes(i) ? .35 : 1.4))), returns = Math.round(orders * retPer[i]);
    return { id: 'DACC' + String(i).padStart(11, '0'), name, orders, spend, returns, returned: Math.round(returns * spend / orders * .9) };
  });
  const top = (f) => [...all].filter((r) => r[f]).sort((a, b) => b[f] - a[f]).slice(0, 10);
  const pn = Math.round(n * .91);
  return { ok: true, data: { count: { cur: n, prev: o.prev == null ? null : Math.max(14, Math.round(o.prev / 2.6)) }, spend: { cur: v.cur * .97, prev: v.prev == null ? null : v.prev * .97 }, orders: Math.round(o.cur * .97),
    repeat: Math.round(n * .38), fresh: from ? Math.round(n * .22) : null, capped: false, bySpend: top('spend'), byOrders: top('orders'), returners: top('returns'),
    kind: [{ key: 'Person accounts', n: pn, v: v.cur * .68 }, { key: 'Business accounts', n: n - pn, v: v.cur * .29 }], objects: { ReturnOrder: true, IsPersonAccount: true } } };
}
export function demoAccount(id) {
  // The dashboard can open an account before the console has loaded any sample data.
  const src = demoPage.data() || demoData(), k = Number(String(id).slice(4)) % 5 || 0, now = Date.now();
  const o = src.stream.data.find((x) => x.AccountId === id) || { Account: { Name: DEMO_ACCTS[Number(String(id).slice(4))] || 'Sample customer' } };
  const P = [[212, 61840, 9, 2140, 1], [96, 88410, 3, 1290, 4], [143, 21730, 38, 6420, 2], [27, 3310, 2, 140, 0], [3, 410, 0, 0, 0]][k];
  const [orders, spend, rn, ramt, open] = P, last = now - [2, 5, 1, 410, 3][k] * 864e5, first = now - [1900, 1400, 1100, 1600, 20][k] * 864e5;
  const rank = (pos, of) => ({ pos, of, capped: false });
  const orders8 = src.stream.data.filter((x) => x.AccountId === id).slice(0, 8);
  return {
    account: { Id: id, Name: o.Account.Name, IsPersonAccount: k !== 1, Type: k === 1 ? 'Customer - Direct' : null, Rating: ['Hot', 'Warm', null, 'Cold', null][k], Industry: k === 1 ? 'Retail' : null,
      PersonEmail: k !== 1 ? o.Account.Name.toLowerCase().replace(/\W+/g, '.') + '@example.com' : null, Phone: '(512) 555-01' + (20 + k), BillingCity: ['Austin', 'Chicago', 'Denver', 'Seattle', 'Atlanta'][k], BillingState: ['TX', 'IL', 'CO', 'WA', 'GA'][k], Owner: { Name: 'Morgan Lee' }, CreatedDate: new Date(first - 864e5 * 30).toISOString() },
    objects: { OrderSummary: true, ReturnOrder: true, Case: true, LoyaltyProgramMember: true },
    value: { orders, spend, aov: spend / orders, first: new Date(first).toISOString(), last: new Date(last).toISOString(), canceled: [3, 1, 6, 2, 0][k],
      last12: { n: [41, 22, 30, 0, 3][k], amount: [12880, 20410, 4630, 0, 410][k] }, rank: { spend: rank([2, 1, 14, 88, 160][k], 172), orders: rank([1, 6, 3, 61, 150][k], 172) } },
    returns: { n: rn, amount: ramt, rate: ramt / spend, perOrder: rn / orders, units: [11, 5, 52, 2, 0][k],
      reasons: rn ? [['Wrong size', .5], ['Damaged', .3], ['Not as described', .2]].map(([key, f]) => ({ key, n: Math.max(1, Math.round(rn * f)), units: Math.max(1, Math.round([11, 5, 52, 2, 0][k] * f)) })) : [],
      rank: rn ? rank([31, 44, 1, 58, 0][k], 60) : null, recent: src.roStream.data.filter((r) => r.Account?.Name === o.Account.Name).slice(0, 3).map((r) => ({ ...r, CreatedDate: r.LastModifiedDate })) },
    recentOrders: orders8.length ? orders8 : [o],
    cases: { open, closed: [6, 3, 9, 1, 0][k] },
    loyalty: { members: k === 1 ? [] : [{ Id: 'DLM' + k, Program: { Name: 'Northwind Rewards' }, MembershipNumber: 'NW-' + (40210 + k), MemberStatus: k === 3 ? 'Inactive' : 'Active', MemberType: 'Individual', EnrollmentDate: new Date(first).toISOString(),
      tiers: [{ LoyaltyTier: { Name: ['Platinum', '', 'Gold', 'Silver', 'Base'][k] } }], points: [{ Name: 'Points', PointsBalance: [18420, 0, 6210, 880, 410][k], TotalPointsAccrued: [61840, 0, 21730, 3310, 410][k], TotalPointsRedeemed: [43420, 0, 15520, 2430, 0][k] }] }] },
  };
}
// Service tab samples: the first six demo customers, with queue items tied to the console's sample orders so the drawers match.
export const DEMO_SVC = DEMO_ACCTS.slice(0, 6).map((name, i) => { const k = i % 5; return { accountId: 'DACC' + String(i).padStart(11, '0'), name,
  email: ['avery@example.com', 'orders@northwind.example', 'jordan.diaz@example.com', 'sam.patel@example.com', 'riley@example.com'][k], phone: `(512) 555-01${String(10 + i)}`,
  city: ['Austin', 'Chicago', 'Denver', 'Seattle', 'Atlanta'][k], state: ['TX', 'IL', 'CO', 'WA', 'GA'][k] }; });
export function demoService(r) {
  const os = demoData().stream.data.slice(0, 30), now = Date.now(), h = (n) => new Date(now - n * 3600000).toISOString();
  const AP = { name: 'Automated Process', person: false }, person = (i) => ({ name: ['Dana Agent', 'Lee Morgan', 'Priya Shah'][i % 3], person: true });
  const acct = (o) => o.AccountId ? { id: o.AccountId, name: o.Account.Name } : null;
  const MSG = { 'Transfer Reservation': 'Transfer reservation failed for the requested location\nretry scheduled', Fulfillment: 'Fulfillment order could not be allocated', Payment: 'Payment capture declined by the gateway', Routing: 'No location can fulfil every line', Returns: 'Return order is waiting on inspection' };
  const groups = Array.from({ length: 16 }, (_, i) => {
    const o = os[(i * 7) % 30], cat = i < 4 ? 'Transfer Reservation' : ['Fulfillment', 'Payment', 'Routing', 'Returns'][i % 4];
    return { kind: 'exception', key: `${o.Id}|${cat}`, id: 'DPE' + String(i).padStart(12, '0'), number: 'PE-' + (9100 + i), subject: MSG[cat], category: cat,
      priority: ['Low', 'Medium', 'Low', 'Low', 'High', 'Critical', 'Medium', 'High'][i % 8], severity: null, count: i < 4 ? [8321, 412, 96, 18][i] : 1 + (i % 3),
      at: h(i < 12 ? 2 + i * 5 : 24 * (20 + i * 3)), owner: i % 4 === 1 ? person(i) : AP, order: { id: o.Id, number: o.OrderNumber }, account: acct(o), fromExceptions: [] };
  });
  const SUBJ = ['Where is my order?', 'Item arrived damaged', 'Charged twice', 'Change delivery address', 'Missing item in package', 'Refund not received', 'Wrong size shipped', 'Cancel my order', 'Gift receipt request'];
  const cases = SUBJ.map((s, n) => { const o = os[n * 2 + 1]; return { kind: 'case', key: 'DCS' + n, id: 'DCS' + String(n).padStart(12, '0'), number: '0000' + (1042 + n), subject: s, category: ['Order Status', 'Damage', 'Billing', 'Delivery', 'Fulfillment', 'Billing', 'Returns', 'Order Change', 'General'][n],
    priority: ['High', 'Medium', 'High', 'Low', 'Medium', 'High', 'Low', 'Medium', 'Low'][n], severity: null, count: 1, at: h(1 + n * 9), owner: n % 3 === 2 ? AP : person(n),
    order: n === 8 ? null : { id: o.Id, number: o.OrderNumber }, account: n === 5 ? null : acct(o), fromExceptions: n === 0 ? [{ category: 'Fulfillment', count: 3 }] : n === 3 ? [{ category: 'Fulfillment', count: 1 }] : [] }; });
  const hours = { today: 24, '7d': 168, '30d': 720, '90d': 2160, '6m': 4380, '1y': 8760 }[r] ?? Infinity, PR = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const items = [...cases, ...groups].filter((x) => now - new Date(x.at) <= hours * 3600000)
    .sort((a, b) => (PR[a.priority] ?? 4) - (PR[b.priority] ?? 4) || String(b.at).localeCompare(String(a.at)));
  return { range: r in { today: 1, '7d': 1, '30d': 1, '90d': 1, '6m': 1, '1y': 1, all: 1 } ? r : '90d', items, truncated: false, objects: { ProcessException: true, Case: true }, errors: [], at: new Date().toISOString() };
}
export function demoSearch(q) {
  const t = String(q || '').trim().toLowerCase(); if (t.length < 2) return [];
  const byOrder = demoData().stream.data.slice(0, 30).filter((o) => o.OrderNumber.startsWith(t)).slice(0, 5).map((o) => { const c = DEMO_SVC.find((x) => x.accountId === o.AccountId) || { accountId: o.AccountId, name: o.Account.Name };
    return { accountId: c.accountId, name: c.name, email: c.email ?? null, city: c.city ?? null, state: c.state ?? null, matched: `Order ${o.OrderNumber}`, orderId: o.Id }; });
  const rest = DEMO_SVC.map((c) => ({ c, m: c.email.toLowerCase() === t ? 'Email' : c.email.toLowerCase().includes(t) ? 'Email' : c.name.toLowerCase().includes(t) ? 'Name' : c.phone.replace(/\D/g, '').includes(t.replace(/\D/g, '') || '§') ? 'Phone' : null }))
    .filter((x) => x.m && !byOrder.some((b) => b.accountId === x.c.accountId)).map(({ c, m }) => ({ accountId: c.accountId, name: c.name, email: c.email, city: c.city, state: c.state, matched: m, orderId: null }));
  return [...byOrder, ...rest].slice(0, 10);
}
export function demoChat(id, cust) {
  const name = String(cust?.account?.Name || 'Avery Chen').split(' ')[0];
  return { chat: { Id: id, Name: '00000812', Status: 'Completed' }, recordUrl: null, entries: [
    { kind: 'system', text: 'Chat Started: Monday, September 28, 2026, 09:14:02 (-0500)' },
    { kind: 'message', at: '3s', who: 'Order Bot', text: `Hello, ${name}! Please select which action I can help you with today:` },
    { kind: 'message', at: '4s', who: 'Order Bot', text: '', buttons: ['View Recent Orders', 'Cancel a Recent Order', 'Return a Recent Order', 'Transfer To Agent'] },
    { kind: 'message', at: '12s', who: name, text: 'Transfer To Agent' },
    { kind: 'system', text: 'Chat Transferred From Order Bot To Dana Agent' },
    { kind: 'message', at: '41s', who: 'Dana Agent', text: "Hi! I can see your order is waiting on a transfer between stores. Let me check what's holding it." },
    { kind: 'message', at: '1m 20s', who: name, text: 'Thanks. I was charged twice too.\nCan you look at that?' },
    { kind: 'message', at: '2m 5s', who: 'Dana Agent', text: "I've opened a case for the duplicate charge. You'll get an email within a day." },
  ] };
}
export function demoCustomer(id, focus) {
  const c = DEMO_SVC.find((x) => x.accountId === id) || { accountId: id, name: DEMO_ACCTS[Number(id.slice(4)) % DEMO_ACCTS.length] || 'Sample customer', email: null, phone: null, city: null, state: null };
  const now = Date.now(), h = (n) => new Date(now - n * 3600000).toISOString(), q = demoService('all').items.filter((x) => x.account?.id === id);
  const mine = demoData().stream.data.slice(0, 30).filter((o) => o.AccountId === id).slice(0, 10);
  const groups = q.filter((x) => x.kind === 'exception').map((x) => ({ order: x.order, category: x.category, count: x.count, at: x.at, id: x.id, number: x.number, message: x.subject, priority: x.priority, severity: x.severity }));
  const open = q.filter((x) => x.kind === 'case').map((x) => ({ Id: x.id, CaseNumber: x.number, Subject: x.subject, Type: x.category, Status: 'New', Priority: x.priority, IsClosed: false, CreatedDate: x.at, Owner: { Name: x.owner.name }, order: x.order }));
  const goods = [['Rain shell', 'NW-4471', 189], ['Trail runner', 'NW-2210', 139], ['Merino tee', 'NW-1180', 48], ['Trek socks 3-pack', 'NW-0912', 24]];
  const orders = mine.map((o, i) => {
    const items = goods.slice(0, 2 + (i % 3)).map(([name, code, price], k) => { const q = 1 + ((i + k) % 2), cx = i % 4 === 3 && k === 0 ? 1 : 0, rt = i % 5 === 2 && k === 1 ? 1 : 0, fs = ['Allocated', 'Pickpack', 'Fulfilled'][i % 3];
      return { id: `DOI${k}${o.Id.slice(5)}`, name, code, status: cx ? 'CANCELED' : 'ORDERED', ordered: q, fulfilled: fs === 'Fulfilled' ? q - cx : 0, canceled: cx, returned: rt, total: price * (q - cx) }; });
    const fs = ['Allocated', 'Pickpack', 'Fulfilled'][i % 3];
    return { ...o, focus: o.Id === focus, shipTo: { name: c.name, city: c.city, state: c.state, method: i % 2 ? '2-Day Express' : 'Ground' }, items,
      fulfillmentOrders: [{ Id: 'DFO' + o.Id.slice(4), FulfillmentOrderNumber: 'FO-0' + o.OrderNumber, Status: fs, FulfilledFromLocation: { Name: ['Dallas DC', 'Reno DC', 'Columbus DC'][i % 3] }, DeliveryMethod: { Name: i % 2 ? '2-Day Express' : 'Ground' }, OrderSummaryId: o.Id,
        FulfilledToCity: c.city, FulfilledToState: c.state, CreatedDate: h(30 + i * 20), LastModifiedDate: h(i % 3 === 0 ? 80 : 6),
        items: items.map((l) => ({ id: l.id, name: l.name, quantity: l.ordered - l.canceled, original: l.ordered })),
        shipments: i % 3 === 1 ? [{ Id: 'DSH' + o.Id.slice(4), ShipmentNumber: 'SH-' + o.OrderNumber, Status: 'In Transit', Provider: 'UPS', TrackingNumber: '1Z999AA1' + o.OrderNumber, TrackingUrl: null, ExpectedDeliveryDate: new Date(now + 2 * 864e5).toISOString() }]
          : i % 3 === 2 ? [{ Id: 'DSH' + o.Id.slice(4), ShipmentNumber: 'SH-' + o.OrderNumber, Status: 'Delivered', Provider: 'FedEx', TrackingNumber: '7749' + o.OrderNumber, TrackingUrl: null, ActualDeliveryDate: h(20) }] : [] }],
    exceptions: groups.filter((g) => g.order.id === o.Id) };
  });
  const closed = { Id: 'DCS9' + id.slice(-11), CaseNumber: '00001001', Subject: 'Question about sizing', Type: 'General', Status: 'Closed', Priority: 'Low', IsClosed: true, CreatedDate: h(24 * 40), Owner: { Name: 'Lee Morgan' }, order: null };
  return {
    account: { Id: id, Name: c.name, PersonEmail: c.email, Phone: c.phone, BillingCity: c.city, BillingState: c.state, IsPersonAccount: true },
    attention: { cases: open, exceptions: groups }, orders, cases: [...open, closed],
    returns: { list: mine.length ? [{ Id: 'DRO' + id.slice(-11), ReturnOrderNumber: 'RO-' + mine[0].OrderNumber, Status: 'Submitted', GrandTotalAmount: 89, CreatedDate: h(30), OrderSummaryId: mine[0].Id, OrderSummary: { OrderNumber: mine[0].OrderNumber } }] : [], refunded: 120, credited: 45 },
    chats: [{ Id: 'DLC' + id.slice(-11), Name: '00000812', Status: 'Completed', StartTime: h(26), Owner: { Name: 'Dana Agent' }, CaseId: open[0]?.Id ?? null, Case: open[0] ? { CaseNumber: open[0].CaseNumber } : null, Order_Summary_Id__c: mine[0]?.Id ?? null }],
    objects: { OrderSummary: true, Case: true, ProcessException: true, ReturnOrder: true, LiveChatTranscript: true, Shipment: true },
    recordUrl: null, instanceUrl: null, at: new Date().toISOString(),
  };
}
export function demoRecord(obj, id) {
  const src = demoPage.data() || demoData();
  const key = { Case: 'caseStream', ProcessException: 'exceptions', FulfillmentOrder: 'foStream', Shipment: 'shStream', ReturnOrder: 'roStream' }[obj];
  const r = { ...(src[key].data.find((x) => x.Id === id) || src[key].data[0]) }, byOrder = (k) => src[k].data.filter((x) => x.OrderSummaryId === r.OrderSummaryId);
  const lines = [{ Product2: { Name: 'Rain shell', ProductCode: 'NW-4471' }, Quantity: 1, OriginalQuantity: 1, QuantityReturned: 1, ReasonForReturn: 'Wrong size', TotalPrice: 189 }, { Product2: { Name: 'Trail runner', ProductCode: 'NW-2210' }, Quantity: 1, OriginalQuantity: 2, QuantityReturned: 1, ReasonForReturn: 'Damaged', TotalPrice: 139 }];
  const cs = byOrder('caseStream')[0];
  if (obj === 'ProcessException' && cs) Object.assign(r, { CaseId: cs.Id, Case: { CaseNumber: cs.CaseNumber, Status: cs.Status, Subject: cs.Subject } });
  r.AccountId ??= (src.orderPool || src.stream.data).find((o) => o.Id === r.OrderSummaryId)?.AccountId;
  if (obj === 'Case') r.Description = 'Customer contacted us about this order. Linked exceptions below.';
  const related = { Case: { exceptions: byOrder('exceptions') }, FulfillmentOrder: { lines, shipments: byOrder('shStream'), exceptions: byOrder('exceptions'),
    routing: { location: r.FulfilledFromLocation?.Name, why: 'Highest Single Location Score', whyTip: 'The highest scoring single location.', score: 178.1, scoreTip: 'A score that shows how well this location matched the routing rules. Higher scoring locations are prioritized.', filled: '3 of 3',
      rules: [{ label: 'Fulfillment Cost', score: 96 }, { label: 'Nearest Location', score: 52.1 }, { label: 'Node Capacity', score: 30 }, { label: 'Overstocked Inventory', score: 0 }], lines: [{ sku: 'NW-4471', filled: 1, requested: 1 }, { sku: 'NW-2210', filled: 2, requested: 2 }] } }, Shipment: { items: lines }, ReturnOrder: { lines, exceptions: [] } }[obj] || {};
  return { record: r, related };
}
