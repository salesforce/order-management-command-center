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
// Salesforce Order Management Operations Console's Dashboard view: the KPI tiles, the domain tabs and their panels, CSV export, the Data map and the order
// policies. Page state is S (console-state.js); the console's other functions come in on `page`.
import { num, keepFocus, $, money, esc, pct, tipAt } from './console-kit.js';
import { PRIOR_LABEL, PERIOD_LABEL, WIDER } from './console-labels.js';
import { S } from './console-state.js';
import { buckets, stats, mdelta, pct1, hbars, ratio, na, dur, columns } from './console-charts.js';
import { panel, AGENT, askStore, csvStore } from './console-panels.js';
import { DEMO } from '../shared/transport/om-mode.js';
import { demoPolicies, DEMO_PRODUCTS } from './console-demo.js';
import { csvText } from './console-csv.js';

// page: the console's functions and constants this part uses.
export function createDashView(page) {
  const { DOMAINS, SF_ID, closeDrawer, closeModal, enterLayer, j, loadInventory, openAny, openOrder, perr, pill, setMode, shownPeriod,
    stackBar } = page;
  // ---------- dashboard ----------
  const dp = (p) => (p && p.ok ? p.data : null);
  function delta(t, fmt = num) {
    if (!t) return '<span class="muted">not in this org</span>';
    if (t.prev == null) return '<span class="muted">all records</span>';
    if (!t.prev && !t.cur) return `<span class="muted">none either period</span>`;
    if (!t.prev) return `<b>new</b> <span class="muted">· 0 ${PRIOR_LABEL[shownPeriod()].replace(/^vs /, 'in ')}</span>`;
    const d = (t.cur - t.prev) / t.prev, arrow = d > 0.005 ? '▲' : d < -0.005 ? '▼' : '■';
    return `<b>${arrow} ${Math.abs(Math.round(d * 100))}%</b> <span class="muted">${PRIOR_LABEL[shownPeriod()]} (${fmt(t.prev)})</span>`;
  }
  const perrD = (...ps) => ps.map((p) => perr(p)).join('');
  function renderDash() { keepFocus(paintDash); }
  function paintDash() {
    const d = S.dash, t = dp(d.tiles) || {}, fmtD = (x) => new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    $('#dTitle').textContent = PERIOD_LABEL[d.period];
    $('#dSub').textContent = d.from ? `${fmtD(d.from)} – now · compared with ${fmtD(d.prevFrom)} – ${new Date(d.prevTo).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, the same elapsed time` : 'Every record in the org';
    const o = t.orders, v = t.value, aov = o && v ? { cur: o.cur ? v.cur / o.cur : 0, prev: o.prev == null ? null : o.prev ? v.prev / o.prev : 0 } : null;
    const rate = t.returns && o?.cur ? t.returns.cur / o.cur : null;
    const tiles = [
      ['Orders', num(o?.cur), 'good', delta(o)],
      ['Order value', money(v?.cur), 'good', delta(v, money)],
      ['Avg order value', aov ? money(aov.cur) : '—', 'good', delta(aov, money)],
      ['Returns', num(t.returns?.cur), t.returns?.cur ? 'warn' : '', t.returns ? `${delta(t.returns)}` : delta(null)],
      ['Refunds issued', money(t.refunds?.cur), '', t.refunds ? delta(t.refunds, money) : delta(null)],
      ['Process exceptions', num(t.exceptions?.cur), t.exceptions?.cur ? 'warn' : '', delta(t.exceptions)],
    ];
    const sub = ['OrderSummary', 'OrderSummary', 'OrderSummary', rate != null ? `${money(t.returnValue?.cur)} · ${(rate * 100).toFixed(1)} per 100 orders` : 'ReturnOrder', t.refundCount ? `${num(t.refundCount.cur)} credit memos` : 'CreditMemo', 'ProcessException'];
    $('#dTiles').innerHTML = tiles.map(([l, val, c, dl], i) => `<div class="kpi ${c}"><div class="l">${l}</div><div class="v">${val}</div><div class="d">${dl}</div><div class="s">${esc(sub[i])}</div></div>`).join('') + (d.tiles.ok ? '' : `<div class="kpi" style="grid-column:1/-1">${perr(d.tiles)}</div>`);

    const n = $('#dNotice');
    if (o && o.cur === 0 && d.period !== 'all') { n.classList.remove('hide'); n.innerHTML = `<b>No orders ${PERIOD_LABEL[d.period].toLowerCase()}.</b> This org's order history is mostly older. <button data-v="${WIDER[d.period]}">Show ${PERIOD_LABEL[WIDER[d.period]].toLowerCase()}</button>`; n.querySelector('button').onclick = (e) => $(`#period [data-v="${e.target.dataset.v}"]`).click(); }
    else n.classList.add('hide');

    const grainWord = { hour: 'hour', day: 'day', month: 'month' }[d.grain];
    const ob = buckets(dp(d.ordersSeries), d.grain, d.from), rb = buckets(dp(d.returnsSeries), d.grain, d.from);
    const kv = (list) => ({ cols: ['name', 'value'], rows: (list || []).map((r) => [r.key, r.n]) });
    const H = (s) => `<h3 class="dh">${s}</h3>`, hl = (list) => (list || []).map((r) => ({ label: r.key, long: r.key, n: r.n }));
    const charts = []; // [selector, buckets, options] drawn after the grid is in the DOM
    const chart = (id, list, opt) => { charts.push([`#${id}`, list, opt]); return `<div class="colwrap" id="${id}"></div>`; };
    const ob2 = d.objects || {};

    // Basket and cancellations (OrderItemSummary + OrderItemSummaryChange)
    const L = dp(d.lines), lc = L?.cur || {}, lp = L?.prev;
    const per = (x, a, b) => (x && x[b] ? x[a] / x[b] : null);
    const basket = L ? stats([
      ['Items per order', per(lc, 'qo', 'o')?.toFixed(2) ?? '—', mdelta(per(lc, 'qo', 'o'), per(lp, 'qo', 'o'))],
      ['Lines per order', per(lc, 'l', 'o')?.toFixed(2) ?? '—', mdelta(per(lc, 'l', 'o'), per(lp, 'l', 'o'))],
      ['Avg unit price', money(per(lc, 'amt', 'qo')), mdelta(per(lc, 'amt', 'qo'), per(lp, 'amt', 'qo'))],
      ['Discount rate', lc.amt ? pct1(-(lc.adj || 0) / lc.amt) : '—', `${money(-(lc.adj || 0))} off`]]) +
      H('Units') + hbars([{ key: 'Ordered', n: lc.qo || 0 }, { key: 'Cancelled', n: lc.qc || 0, s: pct1(ratio(lc.qc, lc.qo)) }, { key: 'Returned', n: lc.qr || 0, s: pct1(ratio(lc.qr, lc.qo)) }], { unit: 'Units', share: false }) +
      `<div class="note">${num(lc.o)} orders, ${num(lc.l)} product lines. Discount rate is line adjustments over list line amount.</div>` : na('OrderItemSummary');
    const cw = dp(d.cancelWhen) || [], pre = cw.find((r) => String(r.key) === 'true')?.n || 0, cwT = cw.reduce((s, r) => s + r.n, 0), cx = dp(d.cancelled);
    const cancel = L ? stats([
      ['Cancel rate', pct1(ratio(lc.qc, lc.qo)), mdelta(ratio(lc.qc, lc.qo), lp && ratio(lp.qc, lp.qo))],
      ['Units cancelled', num(lc.qc), `of ${num(lc.qo)} ordered`],
      ['Cancelled value', money(cx?.value), cx?.capped ? 'newest 2,000 lines' : 'qty × unit price'],
      ['Before fulfillment', cwT ? pct(pre / cwT) : '—', cwT ? `${num(pre)} of ${num(cwT)} cancels` : 'no cancel changes']]) +
      `<div class="two"><div>${H('Cancel reasons')}${hbars((dp(d.cancelReasons) || []).map((r) => ({ ...r, key: r.key === '(blank)' ? '(no reason)' : r.key })), { color: 'var(--d6)', unit: 'Cancel changes' })}</div>
     <div>${H('Most-cancelled products')}${hbars((cx?.products || []).map((r) => ({ ...r, s: money(r.v) })), { color: 'var(--d6)', unit: 'Units cancelled', share: false })}</div></div>` : na('OrderItemSummary');

    // Fulfillment speed, backlog, locations, carriers
    const sp = dp(d.speed);
    const speed = sp ? stats([
      ['Order → routed', dur(sp.route.p50), `typical · p90 ${dur(sp.route.p90)}`],
      ['Routed → closed', dur(sp.close.p50), `typical · p90 ${dur(sp.close.p90)}`],
      ['FOs measured', num(sp.rows), sp.capped ? 'newest 2,000 in period' : 'created in period'],
      ['With a close date', num(sp.close.n), sp.rows ? `${pct(sp.close.n / sp.rows)} of FOs` : '']]) +
      `<div class="two"><div>${H('Order to routed')}${chart('cSpR', hl(sp.route.hist), { unit: 'Fulfillment orders', h: 130, color: 'var(--d6)' })}</div><div>${H('Routed to closed')}${chart('cSpC', hl(sp.close.hist), { unit: 'Fulfillment orders', h: 130, color: 'var(--d3)' })}</div></div>
    <div class="note">Routed is OrderSummary.OrderedDate to FulfillmentOrder.CreatedDate. Closed uses FulfillmentOrder.ClosedDate, which only ${num(sp.close.n)} of these FOs have.</div>` : na('FulfillmentOrder');
    const oa = sp?.openAge || [], oaT = oa.reduce((s, r) => s + r.n, 0);
    const foAge = sp ? stats([['Open now', num(oaT), 'not fulfilled, cancelled, rejected or closed'], ['Older than 30 d', num(oa.slice(4).reduce((s, r) => s + r.n, 0)), oaT ? pct(oa.slice(4).reduce((s, r) => s + r.n, 0) / oaT) + ' of open' : '']]) + hbars(oa, { unit: 'Open fulfillment orders' }) + '<div class="note">A snapshot of today\'s backlog, independent of the period.</div>' : na('FulfillmentOrder');
    const locs = dp(d.locations) || [], rbl = sp?.routeByLoc || {};
    const rateCell = (n, tot, color) => `<td class="num">${num(n)} <span class="rt" title="${tot ? pct1(n / tot) : ''}"><i style="width:${tot ? Math.max(n ? 3 : 0, 100 * n / tot) : 0}%;background:${color}"></i></span><small class="muted">${tot ? pct1(n / tot) : ''}</small></td>`;
    const locTable = locs.length ? `<table class="score"><thead><tr><th>Location</th><th>Type</th><th class="num">FOs</th><th class="num">Fulfilled</th><th class="num">Rejected</th><th class="num">Cancelled</th><th class="num">Open</th><th class="num">Order → routed</th></tr></thead><tbody>${locs.slice(0, 12).map((x) => `<tr style="cursor:default"><td>${esc(x.name)}</td><td class="muted">${esc(x.type || '—')}</td><td class="num"><b>${num(x.total)}</b></td>${rateCell(x.fulfilled, x.total, 'var(--d3)')}${rateCell(x.rejected, x.total, 'var(--st-fail)')}${rateCell(x.cancelled, x.total, 'var(--muted)')}${rateCell(x.open, x.total, 'var(--d1)')}<td class="num">${dur(rbl[x.name])}</td></tr>`).join('')}</tbody></table>${locs.length > 12 ? `<div class="note">Top 12 of ${num(locs.length)} locations by volume. The CSV has all of them.</div>` : ''}` : '<div class="empty" style="padding:var(--sp-3) 0">No fulfillment orders in this period.</div>';
    const lg = dp(d.locGroups) || [];
    const groups = ob2.LocationGroupAssignment === false ? na('LocationGroupAssignment') : hbars(lg.map((r) => ({ ...r, s: `${r.locations} loc` })), { color: 'var(--d3)', unit: 'Fulfillment orders', share: false }) + (lg.length ? '<div class="note">FOs shipped from locations in each group. A location can belong to more than one group.</div>' : '');
    const ca = dp(d.carriers), caSt = {};
    (ca?.list || []).forEach((c) => Object.entries(c.status).forEach(([k, n]) => (caSt[k] = (caSt[k] || 0) + n)));
    const meas = (ca?.list || []).reduce((s, c) => s + c.measured, 0), ontime = (ca?.list || []).reduce((s, c) => s + c.onTime, 0), noProv = ca?.list.find((c) => c.key === '(not set)')?.n || 0;
    const carrier = ca ? stats([['Shipments', num(ca.total), ''], ['On time', meas ? pct(ontime / meas) : '—', meas ? `${num(meas)} measured` : 'not measurable'], ['Delivered', num(ca.withActual), 'with a delivery date']]) +
      hbars(ca.list.map((c) => ({ key: c.key, n: c.n, s: c.measured ? `${pct(c.onTime / c.measured)} on time` : '', tip: c.transitP50 != null ? `<div class='r'><span>Typical transit</span><span>${c.transitP50.toFixed(1)} d</span></div>` : '' })), { unit: 'Shipments', share: false }) +
      (Object.keys(caSt).length ? `<div class="sb" style="padding:var(--sp-6) 0 0">${stackBar('By status', Object.entries(caSt).map(([key, n]) => ({ key, n })))}</div>` : '') +
      (ca.total && (!ca.withActual || noProv) ? `<div class="note">${!ca.withActual ? 'No shipment has an ActualDeliveryDate yet, so on-time and transit time can\'t be measured. ' : ''}${noProv ? `${num(noProv)} of ${num(ca.total)} shipments have no carrier (Provider) set.` : ''}</div>` : '') : na('Shipment');

    // Money flow
    const mo = dp(d.money), BAD = ['Failed', 'Canceled', 'Cancelled', 'Declined', 'Voided'];
    const sumA = (o) => Object.entries(o || {}).filter(([k]) => !BAD.includes(k)).reduce((s, [, x]) => s + (x.a || 0), 0);
    const badC = (o) => BAD.reduce((s, k) => s + (o?.[k]?.c || 0), 0);
    const stTip = (o) => Object.entries(o || {}).map(([k, x]) => `<div class='r'><span>${esc(k)}</span><span>${num(x.c)} · ${money(x.a)}</span></div>`).join('');
    let moneyBody = na('Payment objects'), moneyCsv = null;
    if (mo) {
      const auth = sumA(mo.auth), cap = sumA(mo.pay), refd = sumA(mo.ref), has = mo.objects;
      const flow = [['Authorized', auth, has.PaymentAuthorization, mo.auth, ''], ['Captured', cap, has.Payment, mo.pay, auth ? `${pct(cap / auth)} of auth` : ''], ['Invoiced', mo.inv.a, has.Invoice, null, auth ? `${pct(mo.inv.a / auth)} of auth` : ''], ['Refunded', refd, has.Refund, mo.ref, cap ? `${pct1(refd / cap)} of capt.` : '']]
        .map(([key, n, ok, st, s]) => ({ key, n: ok ? n : 0, s: ok ? s : 'not in org', tip: st ? stTip(st) : key === 'Invoiced' ? `<div class='r'><span>Invoices</span><span>${num(mo.inv.c)}</span></div><div class='r'><span>Open balance</span><span>${money(mo.inv.b)}</span></div>` : '' }));
      moneyCsv = { cols: ['stage', 'amount'], rows: flow.map((r) => [r.key, r.n]) };
      moneyBody = stats([
        ['Capture rate', auth ? pct(cap / auth) : '—', 'captured ÷ authorized'],
        ['Refund rate', cap ? pct1(refd / cap) : '—', 'refunded ÷ captured'],
        ['Open invoice balance', money(mo.inv.b), `${num(mo.inv.c)} invoices`],
        ['Failed', num(badC(mo.pay)), `payments · ${num(badC(mo.ref))} refunds · ${num(badC(mo.auth))} auths`]]) +
        hbars(flow, { fmt: money, unit: 'Amount', share: false }) +
        `<div class="note">Funds are captured as items ship, so captured trails authorized while orders are open. Failed and cancelled records are left out of each stage.${t.refunds ? ` Credit memos issued: <b style="color:var(--ink)">${money(t.refunds.cur)}</b> across ${num(t.refundCount?.cur)}.` : ''}</div>`;
    }

    // Money still open on orders: shipped but not paid (invoice balance), refund owed but not created (credit memo balance).
    const se = dp(d.settlement), longDate = (x) => x ? new Date(x).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const openTable = (x, doc, empty) => x.top.length ? `<table class="score acctrank"><thead><tr><th></th><th>Order</th><th>Status</th><th class="num">${doc}s</th><th class="num">${doc} total</th><th class="num">Open balance</th><th class="num">Created</th></tr></thead><tbody>${x.top.map((r, i) =>
    `<tr${r.id ? ` data-order="${esc(r.id)}" tabindex="0" title="Open order ${esc(r.number || '')}"` : ''}><td>${i + 1}</td><td><b>${esc(r.number || r.id || '—')}</b></td><td>${r.status ? pill(r.status) : '<span class="muted">—</span>'}</td><td class="num">${num(r.docs)}</td><td class="num">${money(r.total)}</td><td class="num"><b>${money(r.balance)}</b></td><td class="num muted">${longDate(r.at)}</td></tr>`).join('')}</tbody></table>${x.orders > x.top.length ? `<div class="note">Top ${x.top.length} of ${num(x.orders)} orders by open balance.</div>` : ''}` : `<div class="empty" style="padding:var(--sp-3) 0">${empty}</div>`;
    const openCsv = (x) => x && { cols: ['order_number', 'order_status', 'documents', 'document_total', 'open_balance', 'created', 'order_id'], rows: x.top.map((r) => [r.number, r.status, r.docs, r.total, r.balance, r.at, r.id]) };
    const unpaid = se?.unpaid, unref = se?.unrefunded;
    const unpaidBody = !se || !unpaid ? na('Invoice') : stats([
        ['Not paid', money(unpaid.amount), 'open invoice balance'],
        ['Orders', num(unpaid.orders), `${num(unpaid.docs)} invoices`],
        ['Shipped, no invoice', se.noInvoice == null ? '—' : num(se.noInvoice), 'ordered in period']]) +
      openTable(unpaid, 'Invoice', 'Every invoice on a shipped order in this period is paid.') +
      '<div class="note">Fulfilled and Partially Fulfilled orders whose invoices still have a balance: the goods shipped but the money wasn\'t captured or applied. Click an order to open it.</div>';
    const unrefBody = !se || !unref ? na('CreditMemo') : stats([
        ['Refund owed', money(unref.amount), 'open credit memo balance'],
        ['Orders', num(unref.orders), `${num(unref.docs)} credit memos`]]) +
      openTable(unref, 'Credit memo', 'Every credit memo in this period has been refunded or applied.') +
      '<div class="note">Credit memos from cancels and returns with nothing refunded or applied yet: the customer is owed money and no refund exists. Click an order to open it.</div>';

    // Exceptions, service
    const er = dp(d.exResolve), ea = dp(d.exAge) || [], eaT = ea.reduce((s, r) => s + r.n, 0);
    const exAge = ob2.ProcessException === false ? na('ProcessException') : stats([['Open now', num(eaT), 'New · Triaged · Paused'], ['Time to resolve', dur(er?.p50), er?.n ? `typical · p90 ${dur(er.p90)}` : 'none resolved in period']]) +
      hbars(ea, { color: 'var(--d4)', unit: 'Open exceptions' }) + (er?.byCategory?.length ? H(`Time to resolve by category <b>${num(er.n)} resolved</b>`) + hbars(er.byCategory.map((r) => ({ ...r, s: ` done` })), { color: 'var(--d6)', fmt: dur, unit: 'Typical time', share: false }) : '') +
      '<div class="note">Backlog age is a snapshot of today. Time to resolve uses LastModifiedDate on resolved exceptions.</div>';
    const cs = dp(d.cases);
    const blankType = (cs?.type || []).find((r) => r.key === '(blank)')?.n || 0;
    const cases = cs ? stats([['Cases created', num(cs.count.cur), mdelta(cs.count.cur, cs.count.prev)], ['Time to close', dur(cs.close.p50), `typical · ${num(cs.close.n)} closed`]]) +
      `<div class="sb" style="padding:0;gap:var(--sp-7)">${cs.origin.length ? stackBar('By origin', cs.origin) : ''}${cs.status.length ? stackBar('By status', cs.status) : ''}</div>` +
      H('By type') + hbars(cs.type.map((r) => ({ ...r, key: r.key === '(blank)' ? '(no type)' : r.key })), { color: 'var(--d6)', unit: 'Cases' }) +
      (blankType && cs.count.cur ? `<div class="note">${pct(blankType / cs.count.cur)} of cases have no Type, so the type split is thin.</div>` : '') : na('Case');

    // Return deep-dive
    const rdays = dp(d.retDays);
    const retDays = rdays ? stats([['Typical', rdays.p50 != null ? `${rdays.p50.toFixed(1)} d` : '—', 'order to return'], ['p90', rdays.p90 != null ? `${rdays.p90.toFixed(0)} d` : '—', `${num(rdays.n)} returns`]]) + chart('cRetD', hl(rdays.hist), { unit: 'Returns', h: 130, color: 'var(--d4)' }) : na('ReturnOrder');
    const rateList = (list) => (list || []).filter((r) => r.ordered > 0).map((r) => ({ key: r.key === '(blank)' ? '(no channel)' : r.key, n: r.returned / r.ordered, s: `${num(r.returned)} / ${num(r.ordered)}`, tip: `<div class='r'><span>Units returned</span><span>${num(r.returned)}</span></div><div class='r'><span>Units ordered</span><span>${num(r.ordered)}</span></div>` }));
    const rch = rateList(dp(d.retByChannel)), rpr = rateList(dp(d.retByProduct)).sort((a, b) => b.n - a.n).slice(0, 6);
    const retChannel = ob2.OrderItemSummary === false ? na('OrderItemSummary') : H(`By sales channel <b>${pct1(ratio(lc.qr, lc.qo))} overall</b>`) + hbars(rch, { color: 'var(--d4)', fmt: pct1, unit: 'Return rate', share: false }) + H('Highest-rate products') + hbars(rpr, { color: 'var(--d4)', fmt: pct1, unit: 'Return rate', share: false }) + '<div class="note">Units returned ÷ units ordered, for orders placed in the period.</div>';
    const ro = dp(d.retOutcome), real = (l) => (l || []).filter((r) => r.key !== '(blank)');
    const retOut = ro ? stats([['Exchange orders', ro.exchanges == null ? '—' : num(ro.exchanges), 'SourceProcess = Exchange'], ['Refunded', ro.refunds ? money(ro.refunds.a) : '—', ro.refunds ? `${num(ro.refunds.c)} refunds` : 'Refund not in org'], ['Units returned', num(lc.qr), 'on orders in period']]) +
      (real(ro.repay).length ? H('Repayment method') + hbars(real(ro.repay), { color: 'var(--d4)', unit: 'Units' }) : '') + (real(ro.plan).length ? H('Processing plan') + hbars(real(ro.plan), { color: 'var(--d4)', unit: 'Units' }) : '') +
      (!real(ro.repay).length && !real(ro.plan).length ? '<div class="note">RepaymentMethod and ProcessingPlan are blank on every return line in this period, so outcome comes from exchange orders and processed refunds.</div>' : '') : '';

    const views = {
      orders: () => `<div class="sect">Orders <span>OrderSummary · OrderItemSummary · OrderItemSummaryChange</span></div>` +
      panel('pOrders', `Orders per ${grainWord}`, 'OrderSummary.OrderedDate', perrD(d.ordersSeries) + '<div class="colwrap"></div>', { cols: ['bucket', 'orders'], rows: ob.map((b) => [b.key, b.n]) }, 'span2', AGENT) +
      panel('pChannels', 'Sales channel mix', 'OrderSummary.SalesChannel', perrD(d.channels) + hbars(dp(d.channels), { unit: 'Orders' }), kv(dp(d.channels)), '', AGENT) +
      panel('pBasket', 'Average basket', 'OrderItemSummary · products', perrD(d.lines) + basket, L && { cols: ['metric', 'current', 'prior'], rows: ['qo', 'qc', 'qr', 'adj', 'amt', 'l', 'o'].map((k) => [k, lc[k], lp?.[k]]) }, '', AGENT) +
      panel('pCancel', 'Cancellations', 'OrderItemSummary · OrderItemSummaryChange', perrD(d.lines, d.cancelled, d.cancelReasons, d.cancelWhen) + cancel, { cols: ['kind', 'name', 'value'], rows: [...(dp(d.cancelReasons) || []).map((r) => ['reason', r.key, r.n]), ...(cx?.products || []).map((r) => ['product units', r.key, r.n]), ...cw.map((r) => ['pre-fulfillment', r.key, r.n])] }, 'span2', AGENT) +
      panel('pChanges', 'Order changes', 'OrderItemSummaryChange.ChangeType', perrD(d.changes) + (ob2.OrderItemSummaryChange === false ? na('OrderItemSummaryChange') : hbars(dp(d.changes), { color: 'var(--d6)', unit: 'Changes' }) + '<div class="note">Every line-level change after the order was placed: cancels, returns, adds and price changes.</div>'), kv(dp(d.changes)), 'span3', AGENT),
      fulfillment: () => `<div class="sect">Fulfillment <span>FulfillmentOrder · Location · Shipment</span></div>` +
      panel('pSpeed', 'Fulfillment speed', 'FulfillmentOrder.CreatedDate · ClosedDate', perrD(d.speed) + speed, sp && { cols: ['measure', 'bucket', 'fos'], rows: [...sp.route.hist.map((r) => ['order→routed', r.key, r.n]), ...sp.close.hist.map((r) => ['routed→closed', r.key, r.n])] }, 'span2', AGENT) +
      panel('pFoAge', 'Open fulfillment backlog', 'FulfillmentOrder · age now', perrD(d.speed) + foAge, kv(oa), '', AGENT) +
      panel('pLocations', 'Location scorecard', 'FulfillmentOrder by FulfilledFromLocation', perrD(d.locations, d.speed) + locTable, { cols: ['location', 'type', 'fos', 'fulfilled', 'rejected', 'cancelled', 'open', 'route_p50_hours'], rows: locs.map((x) => [x.name, x.type, x.total, x.fulfilled, x.rejected, x.cancelled, x.open, rbl[x.name]?.toFixed(2)]) }, 'span3', AGENT) +
      panel('pFulfill', 'Fulfillment', 'FulfillmentOrder', perrD(d.foStatus, d.foMix) + `<div class="sb" style="padding:0;gap:var(--sp-8)">${stackBar('Fulfillment orders by status', dp(d.foStatus) || [])}<div><h3><span>Shipped from</span></h3>${hbars(dp(d.foMix), { color: 'var(--d3)', unit: 'Fulfillment orders' })}</div></div>`, kv([...(dp(d.foStatus) || []).map((r) => ({ key: 'status: ' + r.key, n: r.n })), ...(dp(d.foMix) || []).map((r) => ({ key: 'from: ' + r.key, n: r.n }))]), '', AGENT) +
      panel('pLocGroups', 'Location groups', 'LocationGroupAssignment', perrD(d.locGroups) + groups, { cols: ['group', 'locations', 'fos'], rows: lg.map((r) => [r.key, r.locations, r.n]) }, '', AGENT) +
      panel('pCarrier', 'Carrier performance', 'Shipment.Provider', perrD(d.carriers) + carrier, ca && { cols: ['carrier', 'shipments', 'delivered', 'measured', 'on_time', 'transit_p50_days'], rows: ca.list.map((c) => [c.key, c.n, c.delivered, c.measured, c.onTime, c.transitP50]) }, '', AGENT),
      payments: () => `<div class="sect">Payments <span>PaymentAuthorization · Payment · Invoice · Refund · CreditMemo</span></div>` +
      panel('pMoney', 'Money flow', 'Authorized → captured → invoiced → refunded', perrD(d.money) + moneyBody, moneyCsv, 'span3', AGENT) +
      panel('pUnpaid', 'Shipped, not paid', 'Invoice.Balance on fulfilled orders', perrD(d.settlement) + unpaidBody, openCsv(unpaid), 'span3', AGENT) +
      panel('pUnrefunded', 'Refund owed, not created', 'CreditMemo.Balance', perrD(d.settlement) + unrefBody, openCsv(unref), 'span3', AGENT),
      service: () => `<div class="sect">Exceptions &amp; service <span>ProcessException · Case</span></div>` +
      panel('pExCat', 'Exceptions by category', 'ProcessException.Category', perrD(d.exCategory, d.exStatus) + hbars(dp(d.exCategory), { color: 'var(--d4)', unit: 'Exceptions' }) + (dp(d.exStatus)?.length ? `<div class="sb" style="padding:var(--sp-7) 0 0">${stackBar('By status', dp(d.exStatus))}</div>` : ''), kv(dp(d.exCategory)), '', AGENT) +
      panel('pExAge', 'Exception age & resolution', 'ProcessException', perrD(d.exAge, d.exResolve) + exAge, { cols: ['kind', 'name', 'value'], rows: [...ea.map((r) => ['open age', r.key, r.n]), ...(er?.byCategory || []).map((r) => ['resolve p50 hours', r.key, r.n?.toFixed(2)])] }, '', AGENT) +
      panel('pCases', 'Customer service', 'Case', perrD(d.cases) + cases, cs && { cols: ['kind', 'name', 'cases'], rows: [...cs.type.map((r) => ['type', r.key, r.n]), ...cs.status.map((r) => ['status', r.key, r.n]), ...cs.origin.map((r) => ['origin', r.key, r.n])] }, '', AGENT),
      returns: () => `<div class="sect">Returns <span>ReturnOrder · ReturnOrderLineItem · OrderItemSummary</span></div>` +
      panel('pRetTime', `Returns per ${grainWord}`, 'ReturnOrder.CreatedDate', perrD(d.returnsSeries, d.retStatus) + '<div class="colwrap"></div>' + (dp(d.retStatus)?.length ? `<div class="sb" style="padding:var(--sp-5) 0 0">${stackBar('Return orders by status', dp(d.retStatus))}</div>` : ''), { cols: ['bucket', 'returns'], rows: rb.map((b) => [b.key, b.n]) }, '', AGENT) +
      panel('pRetWhy', 'Return drivers', 'ReturnOrderLineItem.ReasonForReturn · units', perrD(d.retReasons) + hbars(dp(d.retReasons), { color: 'var(--d4)', unit: 'Units returned' }), kv(dp(d.retReasons)), '', AGENT) +
      panel('pRetSku', 'Most-returned products', 'ReturnOrderLineItem.Product2 · units', perrD(d.retProducts) + hbars(dp(d.retProducts), { unit: 'Units returned' }), kv(dp(d.retProducts)), '', AGENT) +
      panel('pRetDays', 'Days to return', 'OrderedDate → ReturnOrder.CreatedDate', perrD(d.retDays) + retDays, rdays && kv(rdays.hist), '', AGENT) +
      panel('pRetRate', 'Return rate', 'OrderItemSummary · units', perrD(d.retByChannel, d.retByProduct) + retChannel, { cols: ['kind', 'name', 'returned', 'ordered'], rows: [...(dp(d.retByChannel) || []).map((r) => ['channel', r.key, r.returned, r.ordered]), ...(dp(d.retByProduct) || []).map((r) => ['product', r.key, r.returned, r.ordered])] }, '', AGENT) +
      panel('pRetOut', 'Return outcome', 'ReturnOrderLineItem · Refund · exchanges', perrD(d.retOutcome) + retOut, ro && { cols: ['kind', 'name', 'units'], rows: [...(ro.repay || []).map((r) => ['repayment', r.key, r.n]), ...(ro.plan || []).map((r) => ['plan', r.key, r.n]), ['exchange orders', '', ro.exchanges], ['refunds processed', ro.refunds?.c, ro.refunds?.a]] }, '', AGENT),
      customers: () => customersView(d),
      products: () => productsView(d),
      policies: () => policiesView(),
    };
    if (!views[S.dtab]) S.dtab = 'orders';
    const cu = dp(d.customers), count = { orders: o?.cur, customers: cu?.count.cur, fulfillment: t.fos?.cur, payments: null, service: t.exceptions?.cur, returns: t.returns?.cur, products: dp(d.prodTotals)?.cur?.n };
    $('#dTabs').innerHTML = DOMAINS.map(([k, label], i) => `<button role="tab" data-t="${k}" class="${k === S.dtab ? 'on' : ''}" aria-selected="${k === S.dtab}" title="${label} (${i + 1})">${label}${count[k] != null ? `<small>${num(count[k])}</small>` : ''}</button>`).join('');
    $('#dGrid').className = `dgrid${S.dtab === 'customers' ? ' c2' : ''}`;
    $('#dGrid').innerHTML = views[S.dtab]();
    if ($('#pOrders')) columns($('#pOrders .colwrap'), ob, { unit: 'Orders' });
    if ($('#pRetTime')) columns($('#pRetTime .colwrap'), rb, { color: 'var(--d4)', unit: 'Returns', h: 150 });
    for (const [sel, list, opt] of charts) if ($(sel)) columns($(sel), list, opt);
    $('#dGrid').querySelectorAll('[data-csv]').forEach((b) => b.onclick = () => downloadCsv(b.dataset.csv));
    $('#dGrid').querySelectorAll('[data-ask]').forEach((b) => b.onclick = () => { S.agentAsk = { tab: S.dtab, id: b.dataset.ask, ...askStore[b.dataset.ask] }; S.agent?.open(); S.agent?.contextChanged(); });
    S.agent?.contextChanged();
    $('#dGrid').querySelectorAll('[data-acct]').forEach((r) => r.onclick = () => { closeDrawer(); openAny('Account', r.dataset.acct); });
    $('#dGrid').querySelectorAll('tr[data-order]').forEach((r) => r.onclick = () => { closeDrawer(); openOrder(r.dataset.order); });
    $('#dGrid').querySelectorAll('[data-prod]').forEach((r) => r.onclick = () => openProduct(r.dataset.prod, r.dataset.pname));
  }
  function setDTab(k) {
    if (k === S.dtab || !DOMAINS.some(([x]) => x === k)) return;
    S.dtab = k; history.replaceState(null, '', `#dashboard/${k}`); hideDTip();
    if (S.dash) { renderDash(); $('#dash').scrollTop = 0; }
  }
  $('#dTabs').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) setDTab(b.dataset.t); };
  // Policies tab: the org's return, cancel and adjustment policies (custom objects from org/policies) and which store uses
  // which. OM Service Console checks its actions against them; here they're only read. Read once, not with the period (Refresh
  // drops it). Each policy is reusable: a store's assignment names one of each kind, and the rest take the kind's default.
  S.policyBook = null; let policyBusy = false;
  function loadPolicies() {
    if (S.policyBook || policyBusy) return;
    policyBusy = true;
    (DEMO ? Promise.resolve(demoPolicies()) : j('/api/policies')).then((r) => { S.policyBook = { ok: true, data: r }; }, (e) => { S.policyBook = { ok: false, error: e.message || String(e) }; })
      .finally(() => { policyBusy = false; if (S.mode === 'dashboard' && S.dtab === 'policies' && S.dash) renderDash(); });
  }
  const POLICY_TYPES = [['return', 'Return policies', 'Return policy'], ['cancel', 'Cancel policies', 'Cancel policy'], ['adjust', 'Adjustment policies', 'Adjustment policy']];
  const policyRuleText = (p) => p.kind === 'return' ? (p.days == null ? 'Any time' : `Within ${num(p.days)} days of ${p.from === 'order' ? 'the order' : 'delivery'}`)
    : p.kind === 'cancel' ? (p.hours == null ? 'Until items ship' : `Within ${num(p.hours)} hours of the order`)
    : ([p.maxPercent != null && `${p.maxPercent}% of products`, p.maxAmount != null && money(p.maxAmount)].filter(Boolean).join(' or ') || 'Any size') + (p.maxPercent != null || p.maxAmount != null ? ' per order, all discounts together' : '');
  function policiesView() {
    loadPolicies();
    const sect = '<div class="sect">Policies <span>Returns · Cancellations · Adjustments · Store assignments</span></div>';
    if (!S.policyBook) return sect + panel('pPolicy', 'Policies', 'org/policies', '<div class="empty" style="padding:var(--sp-3) 0">Reading the policies…</div>', null, 'span3');
    const b = dp(S.policyBook);
    const why = { hidden: '<b>This org has policies, but you can’t read them.</b> OM Service Console refuses the returns, cancels and discounts they govern for anyone without the <b>OM Policies Read</b> permission set. Ask an admin for it.',
      unknown: 'The policy objects can’t be read, and whether the org has them can’t be told either (that needs Setup access). If it has them, ask an admin for <b>OM Policies Read</b>.',
      none: 'Deploy <b>org/policies</b> and give agents <b>OM Policies Read</b>. Until then OM Service Console checks no policy.' };
    if (!b?.available) return sect + panel('pPolicy', 'Policies', 'org/policies', perr(S.policyBook) + (b ? (b.state === 'none' ? na('The policy objects') : '') + `<div class="note">${why[b.state] || why.none}</div>` : ''), null, 'span3');
    // A default also covers the stores whose assignment leaves its kind blank.
    const as = b.assignments || [], stores = (k, p) => as.filter((a) => (a[k] ? a[k].slice(0, 15) === p.id.slice(0, 15) : p.isDefault)).map((a) => a.store || a.storeId);
    const nameText = (k, id) => (id ? (b[k] || []).find((p) => p.id.slice(0, 15) === id.slice(0, 15))?.name || 'inactive or deleted' : 'default');
    const nameOf = (k, id) => (id ? esc(nameText(k, id)) : '<span class="muted">default</span>');
    const kind = ([k, title, obj]) => {
      const list = b[k];
      const body = list == null ? na(obj) : !list.length ? '<div class="empty" style="padding:var(--sp-3) 0">No active policy. Nothing is checked.</div>'
        : `<table class="score"><thead><tr><th>Policy</th><th>Rule</th><th>When broken</th><th>Applies to</th></tr></thead><tbody>${list.map((p) => { const st = stores(k, p);
        return `<tr style="cursor:default" title="${esc(p.description || '')}"><td><b>${esc(p.name || p.id)}</b>${p.isDefault ? ' <span class="pill"><s style="background:var(--signal)"></s>Default</span>' : ''}</td><td>${esc(policyRuleText(p))}</td><td>${p.enforce === 'warn' ? 'Warns' : 'Blocks'}</td><td class="muted">${esc([p.isDefault ? 'Every store without its own' : '', ...st].filter(Boolean).join(', ') || 'No store yet')}</td></tr>`; }).join('')}</tbody></table>`
          + (list.length && !list.some((p) => p.isDefault) ? '<div class="note">No default: a store without an assignment has no policy of this kind.</div>' : '') + (list.filter((p) => p.isDefault).length > 1 ? '<div class="note">More than one default: the first by name is used.</div>' : '');
      return [title, obj, body, list?.length ? { cols: ['policy', 'rule', 'enforcement', 'default', 'stores'], rows: list.map((p) => [p.name, policyRuleText(p), p.enforce, p.isDefault, stores(k, p).join('; ')]) } : null];
    };
    const [ret, can, adj] = POLICY_TYPES.map(kind);
    const assign = as.length ? `<table class="score"><thead><tr><th>Store</th><th>Return</th><th>Cancel</th><th>Adjustment</th></tr></thead><tbody>${as.map((a) => `<tr style="cursor:default"><td><b>${esc(a.store || a.storeId)}</b></td>${POLICY_TYPES.map(([k]) => `<td>${nameOf(k, a[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : '<div class="empty" style="padding:var(--sp-3) 0">No store has its own policies: every store takes the defaults.</div>';
    return sect + panel('pPolReturn', ret[0], ret[1], ret[2], ret[3], 'span3', AGENT) + panel('pPolCancel', can[0], can[1], can[2], can[3], 'span3', AGENT) + panel('pPolAdjust', adj[0], adj[1], adj[2], adj[3], 'span3', AGENT) + panel('pPolAssign', 'Store assignments', 'Store policy assignment', assign + '<div class="note">A kind left blank, or a store not listed, takes that kind\'s default.</div>',
      as.length ? { cols: ['store', 'return', 'cancel', 'adjustment'], rows: as.map((a) => [a.store, ...POLICY_TYPES.map(([k]) => nameText(k, a[k]))]) } : null, 'span3', AGENT);
  }

  // Customers tab: who ordered in the period, the accounts worth the most, and the ones that return the most.
  function customersView(d) {
    const cu = dp(d.customers), H = (s) => `<h3 class="dh">${s}</h3>`;
    const sect = '<div class="sect">Customers <span>OrderSummary · ReturnOrder · Account</span></div>';
    if (!cu) return sect + panel('pCust', 'Customers', 'OrderSummary.AccountId', perrD(d.customers) || na('OrderSummary'), null, 'span3');
    const n = cu.count.cur, spend = cu.spend.cur, top10 = cu.bySpend.reduce((s, r) => s + r.spend, 0);
    const summary = stats([
      ['Customers', num(n), mdelta(n, cu.count.prev) || 'ordered in period'],
      ['New', cu.fresh == null ? '—' : num(cu.fresh), cu.fresh == null ? 'no earlier period' : n ? `${pct(cu.fresh / n)} first order ever` : ''],
      ['Repeat', num(cu.repeat), n ? `${pct(cu.repeat / n)} ordered 2+ times` : ''],
      ['Spend per customer', money(n ? spend / n : null), mdelta(n ? spend / n : null, cu.count.prev ? cu.spend.prev / cu.count.prev : null)],
      ['Orders per customer', n ? (cu.orders / n).toFixed(1) : '—', `${num(cu.orders)} orders`],
      ['Top 10 share', spend ? pct(top10 / spend) : '—', `${money(top10)} of ${money(spend)}`]]);
    const kind = cu.kind?.length ? `<div class="two"><div>${H('Customer type · accounts')}${hbars(cu.kind, { color: 'var(--d6)', unit: 'Customers' })}</div><div>${H('Customer type · spend')}${hbars(cu.kind.map((r) => ({ ...r, n: r.v })), { color: 'var(--d3)', fmt: money, unit: 'Spend' })}</div></div>` : '';
    const table = (list, cols) => list.length ? `<table class="score acctrank"><thead><tr><th></th><th>Account</th>${cols.map(([h]) => `<th class="num">${h}</th>`).join('')}</tr></thead><tbody>${list.map((r, i) => `<tr data-acct="${esc(r.id)}" tabindex="0" title="Open ${esc(r.name)}"><td>${i + 1}</td><td><b>${esc(r.name)}</b></td>${cols.map(([, f]) => `<td class="num">${f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="empty" style="padding:var(--sp-3) 0">No orders with an account in this period.</div>';
    const rate = (r) => r.spend ? pct1(r.returned / r.spend) : r.returned ? '—' : '0%';
    const rets = (r) => r.returns ? `${num(r.returns)} <span class="muted">· ${money(r.returned)}</span>` : '<span class="muted">none</span>';
    const shop = [['Orders', (r) => num(r.orders)], ['Spend', (r) => money(r.spend)], ['Share', (r) => spend ? pct1(r.spend / spend) : '—'], ['Returns', rets], ['Return rate', rate]];
    const ret = [['Returns', (r) => `<b>${num(r.returns)}</b>`], ['Returned', (r) => money(r.returned)], ['Orders', (r) => num(r.orders)], ['Spend', (r) => money(r.spend)], ['Return rate', rate]];
    const csv = (list) => ({ cols: ['rank', 'account_id', 'account', 'orders', 'spend', 'returns', 'returned'], rows: list.map((r, i) => [i + 1, r.id, r.name, r.orders, r.spend, r.returns, r.returned]) });
    return sect +
      panel('pCust', 'Customer base', 'OrderSummary.AccountId · not canceled', perrD(d.customers) + summary + kind +
        `<div class="note">A customer is an account with at least one order in the period that wasn't canceled. New means their first order ever is in the period.${cu.capped ? ' Counts stop at 2,000 accounts.' : ''}</div>`,
        { cols: ['metric', 'value'], rows: [['customers', n], ['new', cu.fresh], ['repeat', cu.repeat], ['spend', spend], ['orders', cu.orders], ...(cu.kind || []).map((r) => [r.key, r.n])] }, 'span3') +
      panel('pTopSpend', 'Top accounts by spend', 'SUM(OrderSummary.GrandTotalAmount)', table(cu.bySpend, shop), csv(cu.bySpend)) +
      panel('pTopOrders', 'Most frequent shoppers', 'COUNT(OrderSummary) by AccountId', table(cu.byOrders, shop), csv(cu.byOrders)) +
      panel('pTopRet', 'Top returners', 'COUNT(ReturnOrder) by AccountId', cu.objects.ReturnOrder ? table(cu.returners, ret) +
        '<div class="note">Returns and orders both fall in the period, so a return can belong to an order placed before it. Click any account to see its lifetime value.</div>' : na('ReturnOrder.AccountId'), csv(cu.returners), 'span3');
  }
  // Products tab: what sold, what earned, what gets cancelled or returned, and what's waiting to ship. No customer data.
  // A row with a product Id opens that product on the console's inventory map (the product search view).
  function productsView(d) {
    const sect = '<div class="sect">Products <span>OrderItemSummary · Product2 · FulfillmentOrderLineItem</span></div>';
    const T = dp(d.prodTotals), tc = T?.cur || {}, tp = T?.prev, top = dp(d.prodTop), rev = dp(d.prodRevenue), fam = dp(d.prodFamily), dem = dp(d.prodDemand);
    const none = (s) => `<div class="empty" style="padding:var(--sp-3) 0">${s}</div>`;
    const attrs = (r) => r.id ? ` data-prod="${esc(r.id)}" data-pname="${esc(r.key)}" tabindex="0" title="Show ${esc(r.key)} on the inventory map"` : ' style="cursor:default"';
    const rateOf = (a, b) => (a == null ? '<span class="muted">—</span>' : `${num(a)} <small class="muted">${pct1(ratio(a, b))}</small>`);
    const summary = T ? stats([
      ['Products sold', num(tc.n), mdelta(tc.n, tp?.n) || 'with a line in the period'],
      ['Units ordered', num(tc.qo), mdelta(tc.qo, tp?.qo)],
      ['Product revenue', money(tc.amt), mdelta(tc.amt, tp?.amt)],
      ['Units per product', tc.n ? (tc.qo / tc.n).toFixed(1) : '—', ''],
      ['Cancel rate', pct1(ratio(tc.qc, tc.qo)), mdelta(ratio(tc.qc, tc.qo), tp && ratio(tp.qc, tp.qo))],
      ['Return rate', pct1(ratio(tc.qr, tc.qo)), mdelta(ratio(tc.qr, tc.qo), tp && ratio(tp.qr, tp.qo))]]) +
      '<div class="note">Product lines (TypeCode = Product) on orders placed in the period. Revenue is the line amount before adjustments.</div>' : na('OrderItemSummary');
    const units = tc.qo || (top?.top || []).reduce((s, r) => s + r.qo, 0);
    const table = top ? (top.top.length ? `<table class="score acctrank"><thead><tr><th></th><th>Product</th><th class="num">Units</th><th class="num">Share</th>${top.revenue ? '<th class="num">Revenue</th>' : ''}<th class="num">Cancelled</th><th class="num">Returned</th></tr></thead><tbody>${top.top.map((r, i) =>
    `<tr${attrs(r)}><td>${i + 1}</td><td><b>${esc(r.key)}</b></td><td class="num"><b>${num(r.qo)}</b></td><td class="num">${units ? pct1(r.qo / units) : '—'}</td>${top.revenue ? `<td class="num">${money(r.amt)}</td>` : ''}<td class="num">${rateOf(r.qc, r.qo)}</td><td class="num">${rateOf(r.qr, r.qo)}</td></tr>`).join('')}</tbody></table>
    <div class="note">Top 10 of ${num(top.products)}${top.capped ? '+' : ''} products by units ordered.${top.top.some((r) => r.id) ? ' Click a product to see its inventory on the console map.' : ''}</div>` : none('No product lines in this period.')) : na('OrderItemSummary');
    const rates = (k, label) => {
      const list = top?.[k];
      if (!top) return na('OrderItemSummary');
      if (!list) return na(`OrderItemSummary.Quantity${label}`);
      return hbars(list.map((r) => ({ key: r.key, n: r.n, s: `${num(r.units)} / ${num(r.ordered)}`, tip: `<div class='r'><span>Units ${label.toLowerCase()}</span><span>${num(r.units)}</span></div><div class='r'><span>Units ordered</span><span>${num(r.ordered)}</span></div>` })),
        { color: k === 'cancelRate' ? 'var(--red)' : 'var(--amber)', fmt: pct1, unit: `${label} rate`, share: false }) +
        `<div class="note">Units ${label.toLowerCase()} ÷ units ordered, for products with at least ${num(top.floor)} units ordered in the period.</div>`;
    };
    const revBody = rev ? hbars(rev.map((r) => ({ key: r.key, n: r.amt, s: `${num(r.qo)} units` })), { color: 'var(--green)', fmt: money, unit: 'Revenue', share: false }) : top && !top.revenue ? na('OrderItemSummary.TotalLineAmount') : na('OrderItemSummary');
    const famBody = fam ? hbars(fam.map((r) => ({ key: r.key, n: r.qo, s: money(r.amt), tip: r.products != null ? `<div class='r'><span>Products</span><span>${num(r.products)}</span></div>` : '' })), { unit: 'Units ordered', share: false }) +
      (fam.some((r) => r.key === '(no family)') ? '<div class="note">Products without a Family are grouped as (no family).</div>' : '') : na('Product2.Family');
    const demBody = dem ? stats([['Units open', num(dem.units), 'on open fulfillment orders'], ['Products', num(dem.products), 'with open demand'], ['Fulfillment orders', num(dem.fos), 'open with product lines']]) +
      (dem.list.length ? `<table class="score acctrank"><thead><tr><th></th><th>Product</th><th class="num">Units open</th><th class="num">Share</th><th class="num">Fulfillment orders</th></tr></thead><tbody>${dem.list.map((r, i) =>
      `<tr${attrs(r)}><td>${i + 1}</td><td><b>${esc(r.key)}</b></td><td class="num"><b>${num(r.n)}</b></td><td class="num">${dem.units ? pct1(r.n / dem.units) : '—'}</td><td class="num">${num(r.fos)}</td></tr>`).join('')}</tbody></table>` : none('No open fulfillment demand.')) +
      '<div class="note">A snapshot of fulfillment orders open now (not fulfilled, cancelled, rejected, picked up or closed), independent of the period.</div>' : na('FulfillmentOrderLineItem');
    const rows = (list, f) => (list || []).map(f);
    return sect +
      panel('pProdSum', 'Product performance', 'OrderItemSummary · products', perrD(d.prodTotals) + summary, T && { cols: ['metric', 'current', 'prior'], rows: ['n', 'qo', 'amt', 'qc', 'qr'].map((k) => [k, tc[k], tp?.[k]]) }, 'span3', AGENT) +
      panel('pProdTop', 'Top products', 'OrderItemSummary.Product2 · units', perrD(d.prodTop) + table, top && { cols: ['product_id', 'product', 'units', 'revenue', 'cancelled', 'returned'], rows: rows(top.top, (r) => [r.id, r.key, r.qo, r.amt, r.qc, r.qr]) }, 'span2', AGENT) +
      panel('pProdRev', 'Top products by revenue', 'OrderItemSummary.Product2 · line amount', perrD(d.prodRevenue) + revBody, rev && { cols: ['product_id', 'product', 'revenue', 'units'], rows: rows(rev, (r) => [r.id, r.key, r.amt, r.qo]) }, '', AGENT) +
      panel('pProdCancel', 'Highest cancel rate', 'OrderItemSummary.QuantityCanceled', perrD(d.prodTop) + rates('cancelRate', 'Canceled'), top?.cancelRate && { cols: ['product', 'cancelled', 'ordered', 'rate'], rows: rows(top.cancelRate, (r) => [r.key, r.units, r.ordered, r.n]) }, '', AGENT) +
      panel('pProdReturn', 'Highest return rate', 'OrderItemSummary.QuantityReturned', perrD(d.prodTop) + rates('returnRate', 'Returned'), top?.returnRate && { cols: ['product', 'returned', 'ordered', 'rate'], rows: rows(top.returnRate, (r) => [r.key, r.units, r.ordered, r.n]) }, '', AGENT) +
      panel('pProdFamily', 'Product family mix', 'Product2.Family · units', perrD(d.prodFamily) + famBody, fam && { cols: ['family', 'products', 'units', 'revenue'], rows: rows(fam, (r) => [r.key, r.products, r.qo, r.amt]) }, '', AGENT) +
      panel('pProdDemand', 'Open fulfillment demand', 'FulfillmentOrderLineItem · open now', perrD(d.prodDemand) + demBody, dem && { cols: ['product_id', 'product', 'units_open', 'fulfillment_orders'], rows: rows(dem.list, (r) => [r.id, r.key, r.n, r.fos]) }, 'span3', AGENT);
  }
  // Open a product from the dashboard in the console's product search view: the inventory map layer, scoped to that product.
  function openProduct(id, name) {
    if (!SF_ID.test(id || '')) return;
    const p = (DEMO && DEMO_PRODUCTS.find((x) => x.Id === id)) || { Id: id, Name: name };
    S.focusKey = null; S.layer = 'inventory'; S.prod = { p, inv: null }; $('#pq').value = p.Name;
    setMode('console'); loadInventory();
  }
  function downloadCsv(id) {
    const { cols, rows: r } = csvStore[id];
    const blob = new Blob([csvText([cols, ...r])], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `om-${id.slice(1).toLowerCase()}-${S.dash.period}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  }
  function openDataMap() {
    const seen = new Set(), list = (S.dash?.sources || []).filter((x) => !seen.has(x.soql) && seen.add(x.soql));
    $('#modal').innerHTML = `<div class="mh"><b>Data map</b><span class="muted">Every query behind ${esc(PERIOD_LABEL[S.dash.period].toLowerCase())}, run live against ${esc($('#orgName').textContent)}. Nothing on this page is precomputed or simulated${DEMO ? ' — except in sample-data mode' : ''}.</span><button id="closeModal" style="margin-left:auto" aria-label="Close">✕</button></div>
    <div class="mb"><table><thead><tr><th>Panel</th><th>Object</th><th>SOQL</th></tr></thead><tbody>${list.map((x) => `<tr style="cursor:default"><td>${esc(x.panel)}</td><td class="muted">${esc(x.object)}</td><td><code>${esc(x.soql)}</code></td></tr>`).join('') || '<tr><td colspan="3" class="muted">No queries recorded (sample data).</td></tr>'}</tbody></table></div>`;
    $('#modal').classList.remove('hide'); $('#scrim').classList.remove('hide'); enterLayer($('#modal'));
    $('#closeModal').onclick = closeModal;
  }
  $('#dataMapBtn').onclick = openDataMap;
  // One tooltip for every dashboard mark (bars, columns): content lives on the mark's data-tip.
  $('#dash').addEventListener('mousemove', (e) => { const m = e.target.closest('[data-tip]'); if (m) showDTip(m, e); else hideDTip(); });
  $('#dash').addEventListener('mouseleave', hideDTip);
  function showDTip(m, e = tipAt(m)) {
    const t = $('#dtip'); t.innerHTML = m.dataset.tip; t.classList.remove('hide');
    const tw = t.offsetWidth, th = t.offsetHeight;
    t.style.left = `${e.clientX + 16 + tw > innerWidth ? e.clientX - tw - 12 : e.clientX + 16}px`; t.style.top = `${Math.min(e.clientY - 10, innerHeight - th - 8)}px`;
  }
  function hideDTip() { $('#dtip').classList.add('hide'); $('#dash .hit.at')?.classList.remove('at'); }
  // Keyboard: a focused mark shows its tooltip; a column chart starts at its latest column, and the arrow keys walk the rest,
  // read out through #dlive.
  function chartAt(svg, i) {
    const hits = svg.querySelectorAll('.hit'), h = hits[Math.max(0, Math.min(hits.length - 1, i))]; if (!h) return;
    hideDTip(); svg.dataset.at = [...hits].indexOf(h); h.classList.add('at'); showDTip(h); $('#dlive').textContent = h.dataset.say;
  }
  $('#dash').addEventListener('focusin', (e) => {
    if (e.target.matches('svg.chart')) chartAt(e.target, e.target.dataset.at ?? Infinity);
    else if (e.target.dataset.tip) showDTip(e.target);
  });
  $('#dash').addEventListener('focusout', hideDTip);
  $('#dash').addEventListener('keydown', (e) => {
    const svg = e.target.closest?.('svg.chart'); if (!svg) return;
    const i = +(svg.dataset.at ?? 0), to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: Infinity }[e.key];
    if (to !== undefined) { e.preventDefault(); chartAt(svg, to); }
  });
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.mode === 'dashboard' && S.dash) renderDash(); }, 150); });

  return { dp, renderDash, setDTab, hideDTip };
}
