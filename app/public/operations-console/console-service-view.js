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
// Salesforce Order Management Operations Console's Service Console view: the team queue, the customer search and the customer 360. Page state is S
// (console-state.js); the console's other functions come in on `page`.
import { S } from './console-state.js';
import { $, esc, num, ago, keepFocus, money } from './console-kit.js';
import { RANGE_LABEL } from './console-labels.js';
import { DEMO } from '../shared/transport/om-mode.js';
import { isAuthFailure } from './console-banner.js';
import { demoCustomer, demoChat, demoSearch } from './console-demo.js';

// page: the console's functions and constants this part uses.
export function createServiceView(page) {
  const { STEPS, acctLink, caseRows, j, openAny, openOrder, openRecord, perr, pill, recAttr, shortDate, showGate, stepOf, svcHash } = page;
  // ---------- service tab ----------
  // Read-only: rows open drawers or the customer 360, and every Salesforce link is a plain <a>. Nothing here writes.
  const qItems = () => (S.svc?.items || []).filter((x) => (S.qKind === 'All' || (S.qKind === 'Cases') === (x.kind === 'case'))
    && (S.qOwner === 'Anyone' || (S.qOwner === 'Assigned') === x.owner.person) && (!S.qCat || x.category === S.qCat));
  function renderQueue() {
    const all = S.svc?.items || [], ob = S.svc?.objects || {}, cats = [...new Set(all.map((x) => x.category).filter(Boolean))].sort();
    if (S.qCat && !cats.includes(S.qCat)) S.qCat = '';
    if ((S.qKind === 'Cases' && ob.Case === false) || (S.qKind === 'Exceptions' && ob.ProcessException === false)) S.qKind = 'All';
    const ae = document.activeElement, inTabs = ae && $('#qTabs').contains(ae), fk = inTabs ? (ae.id === 'qCat' ? '#qCat' : ae.dataset.k ? `[data-k="${ae.dataset.k}"]` : ae.dataset.o ? `[data-o="${ae.dataset.o}"]` : null) : null;
    const chip = (attr, v, cur) => `<button class="chip ${v === cur ? 'on' : ''}" data-${attr}="${v}" aria-pressed="${v === cur}">${v}</button>`;
    $('#qTabs').innerHTML = ['All', ...(ob.Case === false ? [] : ['Cases']), ...(ob.ProcessException === false ? [] : ['Exceptions'])].map((v) => chip('k', v, S.qKind)).join('')
      + ['Anyone', 'Assigned', 'Unassigned'].map((v) => chip('o', v, S.qOwner)).join('')
      + `<select id="qCat" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option ${c === S.qCat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
    if (fk) $('#qTabs').querySelector(fk)?.focus();
    const list = qItems();
    if (S.qSel && !list.some((x) => x.key === S.qSel)) S.qSel = null;
    $('#qSub').textContent = S.svc ? `${num(list.length)} open · ${RANGE_LABEL[S.svc.range] || S.svc.range}${S.svc.truncated ? ` · showing the newest ${num(all.length)}` : ''}` : '';
    $('#queue').innerHTML = (S.svc?.errors || []).map((e) => perr({ ok: false, error: e })).join('')
      + (list.length ? list.map(qRow).join('') : `<div class="empty">${all.length ? 'Nothing matches these filters.' : 'Nothing open in this range.'}</div>`);
    if (S.qSel) $('#queue').setAttribute('aria-activedescendant', `q-${S.qSel}`); else $('#queue').removeAttribute('aria-activedescendant');
    if (!S.custId) renderCustomer();
  }
  function qRow(x) {
    const title = x.order?.number ? `Order ${x.order.number}` : x.number || (x.kind === 'case' ? 'Case' : 'Exception');
    const what = x.kind === 'case' ? x.subject : [x.category, (x.subject || '').split('\n')[0]].filter(Boolean).join(' · ');
    return `<div class="item qrow ${x.key === S.qSel ? 'sel' : ''}" id="q-${esc(x.key)}" data-q="${esc(x.key)}" role="option" aria-selected="${x.key === S.qSel}">
    <i class="edge ${esc(x.priority || '')}" title="${esc(x.priority ? `${x.priority} priority` : 'Priority unknown')}"></i>
    <span class="sev ${esc(x.priority || '')}">${x.kind === 'case' ? 'Case' : 'Exception'}</span>
    <div style="min-width:0"><div class="t">${esc(title)} · ${esc(x.account?.name || 'No customer')}${x.count > 1 ? ` <span class="badge warn">×${num(x.count)}</span>` : ''}</div>
      <div class="s">${esc(what || '')}</div>
      ${x.fromExceptions.length ? `<div class="muted" style="font-size:var(--fs-sm)">from exception · ${x.fromExceptions.map((f) => `${esc(f.category)} ×${num(f.count)}`).join(', ')}</div>` : ''}</div>
    <div class="w">${ago(x.at)}<div>${esc(x.owner.name || '—')}</div></div>
  </div>`;
  }
  $('#qTabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.k) S.qKind = b.dataset.k; if (b.dataset.o) S.qOwner = b.dataset.o; renderQueue(); };
  $('#qTabs').onchange = (e) => { if (e.target.id === 'qCat') { S.qCat = e.target.value; renderQueue(); } };
  $('#queue').onclick = (e) => { const r = e.target.closest('[data-q]'); if (r) openQueueItem(r.dataset.q); };
  // The queue is one tab stop, a listbox: ↑ ↓ (or j k anywhere on the tab) move the selection, Enter opens it.
  $('#queue').onkeydown = (e) => {
    if (e.target !== $('#queue')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveQueue(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (S.qSel) openQueueItem(S.qSel); else moveQueue(1); }
  };
  function openQueueItem(key) {
    const x = (S.svc?.items || []).find((i) => i.key === key); if (!x) return;
    S.qSel = key; renderQueue();
    // A customer opens the 360 with the order highlighted; with no customer, fall back to the order or record drawer.
    if (x.account?.id) loadCustomer(x.account.id, { focusOrder: x.order?.id || null });
    else if (x.order) openOrder(x.order.id);
    else if (x.id) openRecord(x.kind === 'case' ? 'Case' : 'ProcessException', x.id);
  }
  function moveQueue(step) {
    const list = qItems(); if (!list.length) return;
    const i = list.findIndex((x) => x.key === S.qSel);
    S.qSel = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + step))].key; renderQueue();
    $(`#queue [data-q="${CSS.escape(S.qSel)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  S.custBusy = false; S.custFailed = null; // a load in flight, and the id whose last load failed (so polling doesn't retry it)
  const pl = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
  const svcLink = (obj, id, label) => !id || DEMO || !S.cust?.instanceUrl ? esc(label) : `<a href="${esc(`${S.cust.instanceUrl}/lightning/r/${obj}/${id}/view`)}" target="_blank" rel="noopener" title="Open in Salesforce">${esc(label)} ↗</a>`;
  async function loadCustomer(id, { focusOrder = null } = {}) {
    // Only the newest request paints, so clicking down the queue can't leave an older customer on screen.
    const seq = ++S.custSeq, fresh = id.slice(0, 15) !== (S.cust?.account?.Id || '').slice(0, 15);
    S.custId = id; S.custBusy = true; S.custFailed = null; S.custFocus = focusOrder;
    if (S.mode === 'service') history.replaceState(null, '', svcHash());
    if (fresh) { S.cust = null; chatOpen.clear(); $('#c360').innerHTML = '<div class="empty">Loading customer…</div>'; }
    try {
      const next = DEMO ? demoCustomer(id, focusOrder)
        : await j(`/api/service/customer/${encodeURIComponent(id)}${focusOrder ? `?order=${encodeURIComponent(focusOrder)}` : ''}`);
      if (seq !== S.custSeq) return;
      S.cust = next; S.custBusy = false; renderCustomer();
    } catch (e) {
      if (seq !== S.custSeq) return;
      S.custBusy = false; S.custFailed = id;
      if (isAuthFailure(e)) return showGate({ error: e.message });
      S.cust = null;
      $('#c360').innerHTML = `<div class="perr">${esc(e.status === 404 ? 'That customer was not found in this org.' : e.message)}</div><button class="chip" data-clear>Back</button>`;
    }
  }
  function clearCustomer() {
    S.custSeq++; S.custBusy = false; S.custFailed = null; S.custId = null; S.cust = null; S.custFocus = null;
    if (S.mode === 'service') history.replaceState(null, '', svcHash());
    renderCustomer();
  }
  function renderCustomer() { keepFocus(paintCustomer); }
  function paintCustomer() {
    S.agent?.contextChanged();
    const el = $('#c360');
    if (!S.custId) {
      const by = new Map();
      for (const x of S.svc?.items || []) if (x.account?.id) { const c = by.get(x.account.id) || { id: x.account.id, name: x.account.name, n: 0 }; c.n++; by.set(x.account.id, c); }
      const top = [...by.values()].sort((a, b) => b.n - a.n).slice(0, 5);
      el.innerHTML = `<div class="empty">Search for a customer (press <kbd>/</kbd>) or pick a row in the queue.</div>`
        + (top.length ? `<h3>Most open items</h3><table><tbody>${top.map((c) => `<tr data-cust="${esc(c.id)}" tabindex="0" style="cursor:pointer"><td><b>${esc(c.name || 'Customer')}</b></td><td class="muted">${pl(c.n, 'open item', 'open items')}</td></tr>`).join('')}</tbody></table>` : '');
      return;
    }
    if (!S.cust) return; // still loading, or the error from loadCustomer is showing
    const c = S.cust, a = c.account, att = c.attention;
    const exN = att.exceptions.reduce((s, g) => s + g.count, 0);
    const inFlight = (c.orders || []).filter((o) => { const s = stepOf(o.Status); return s >= 0 && s <= 2; }).length;
    const retOpen = (c.returns?.list || []).filter((r) => !/closed|cancel|complete/i.test(r.Status || '')).length;
    el.innerHTML = `<div class="chd"><h2>${esc(a.Name)}</h2>
      <span class="muted">${[a.PersonEmail, a.Phone || a.PersonMobilePhone, [a.BillingCity, a.BillingState].filter(Boolean).join(', ')].filter(Boolean).map(esc).join(' · ')}</span>
      <span style="margin-left:auto;display:flex;gap:var(--sp-4)">${acctLink(a.Id, 'Customer value')}${!DEMO && c.recordUrl ? `<a class="chip" href="${esc(c.recordUrl)}" target="_blank" rel="noopener">Open in Salesforce ↗</a>` : ''}<button class="chip" data-clear>Clear</button></span></div>
    <div class="chips">${c.objects.Case ? `<span class="badge ${att.cases.length ? 'warn' : ''}">${pl(att.cases.length, 'open case', 'open cases')}</span>` : ''}${c.objects.ProcessException ? `<span class="badge ${exN ? 'warn' : ''}">${pl(exN, 'open exception', 'open exceptions')}</span>` : ''}${c.orders ? `<span class="badge">${pl(inFlight, 'order in flight', 'orders in flight')}</span>` : ''}${c.returns ? `<span class="badge">${pl(retOpen, 'return in progress', 'returns in progress')}</span>` : ''}</div>
    ${attention(c)}${ordersTable(c)}
    ${c.cases && c.cases.some((x) => x.IsClosed) ? `<h3>Recent closed cases</h3>${caseRows(c.cases.filter((x) => x.IsClosed))}` : ''}
    ${returnsBlock(c)}${chatsBlock(c)}`;
  }
  function attention(c) {
    const { cases, exceptions } = c.attention;
    if (!cases.length && !exceptions.length) return '<h3>Needs attention</h3><div class="muted">Nothing open for this customer.</div>';
    // Group by order, newest activity first; cases without an order go under "No order".
    const g = new Map(), put = (oid, num, at, html) => { const k = oid || ''; const cur = g.get(k) || { oid, num, at: '', rows: [] }; cur.rows.push(html); if (String(at || '') > cur.at) cur.at = String(at || ''); g.set(k, cur); };
    for (const x of cases) put(x.order?.id, x.order?.number, x.CreatedDate, `<tr ${recAttr('Case', x.Id)}><td><span class="sev ${esc(x.Priority || '')}">Case</span></td><td><b>${esc(x.CaseNumber)}</b> ${esc(x.Subject || '')}</td><td>${pill(x.Status)}</td><td class="muted">${ago(x.CreatedDate)}</td></tr>`);
    // A grouped exception may carry only a category and a count (no sample row), so id, number and message can be null.
    for (const x of exceptions) put(x.order?.id, x.order?.number, x.at, `<tr ${recAttr('ProcessException', x.id)}><td><span class="sev ${esc(x.priority || '')}">Exception</span></td><td><b>${esc(x.category || 'Exception')}</b>${x.count > 1 ? ` <span class="badge warn">×${num(x.count)}</span>` : ''}${x.number ? ` <span class="muted">${esc(x.number)}</span>` : ''} <span class="muted">${esc((x.message || '').split('\n')[0])}</span></td><td class="muted">${esc(x.priority || '—')}</td><td class="muted">${ago(x.at)}</td></tr>`);
    return `<h3>Needs attention</h3>${[...g.values()].sort((a, b) => b.at.localeCompare(a.at)).map((o) => `<div class="agrp"><table><thead><tr><th colspan="4">${o.oid ? `<button class="acct" data-order="${esc(o.oid)}">Order ${esc(o.num || '')} →</button>` : 'No order'}</th></tr></thead><tbody>${o.rows.join('')}</tbody></table></div>`).join('')}`;
  }
  function ordersTable(c) {
    if (!c.orders) return '';
    if (!c.orders.length) return '<h3>Orders</h3><div class="muted">No orders.</div>';
    return `<h3>Orders <span style="text-transform:none;letter-spacing:0">· ${num(c.orders.length)}</span></h3>${c.orders.map(orderCard).join('')}`;
  }
  // One order: header (number, status, total, when, channel, ship-to), stage bar, open exceptions, then items beside fulfillment.
  function orderCard(o) {
    // Order status can lag its FOs (an Approved order with allocated FOs is already fulfilling), so FOs lift the stage.
    const st0 = stepOf(o.Status), st = st0 >= 0 && st0 < 2 && o.fulfillmentOrders.length ? 2 : st0, to = o.shipTo, where = to && [to.city, to.state].filter(Boolean).join(', ');
    const meta = [shortDate(o.OrderedDate || o.CreatedDate), o.SalesChannel?.SalesChannelName, to?.method, where && `→ ${where}`].filter(Boolean).map(esc).join(' · ');
    const ex = o.exceptions.map((x) => `<button class="sev ${esc(x.priority || '')}" ${recAttr('ProcessException', x.id)} title="${esc((x.message || '').split('\n')[0])}">${esc(x.category || 'Exception')}${x.count > 1 ? ` ×${num(x.count)}` : ''}</button>`).join('');
    return `<div class="ocard${o.focus ? ' picked' : ''}"><div class="ohd"><button class="acct" data-order="${esc(o.Id)}"><b>${esc(o.OrderNumber)}</b> →</button>${pill(o.Status)}${o.focus ? '<span class="badge warn">From the queue</span>' : ''}
      <span class="muted">${meta}</span><b class="num" style="margin-left:auto">${money(o.GrandTotalAmount)}</b></div>
    <div class="steps slim ${st < 0 ? 'cancel' : ''}">${STEPS.map((s, i) => `<div class="${st < 0 ? (i === 0 ? 'cur' : '') : i < st ? 'done' : i === st ? 'cur' : ''}">${st < 0 && i === 0 ? 'Cancelled' : s}</div>`).join('')}</div>
    ${ex ? `<div class="oex"><span class="muted">Open exceptions</span>${ex}</div>` : ''}
    <div class="ocols">${o.items ? `<div>${itemsBlock(o.items)}</div>` : ''}<div>${foBlock(o, st)}</div></div></div>`;
  }
  function itemsBlock(items) {
    if (!items.length) return '<h4>Items</h4><div class="muted">No product lines.</div>';
    const units = items.reduce((s, l) => s + (l.ordered || 0), 0), shown = items.slice(0, 6);
    // What happened to each line, in the order an agent asks: cancelled, returned, then how much has shipped.
    const fate = (l) => [l.canceled ? `<span style="color:var(--red)">${num(l.canceled)} cancelled</span>` : '', l.returned ? `<span style="color:var(--amber)">${num(l.returned)} returned</span>` : '',
      l.ordered && l.fulfilled >= l.ordered ? '<span style="color:var(--green)">fulfilled</span>' : l.fulfilled ? `${num(l.fulfilled)} of ${num(l.ordered)} fulfilled` : ''].filter(Boolean).join(' · ');
    return `<h4>Items · ${pl(units, 'unit', 'units')}</h4><table class="lines"><tbody>${shown.map((l) => `<tr><td>${esc(l.name || l.code || 'Item')}${fate(l) ? `<div class="muted">${fate(l)}</div>` : ''}</td><td class="num muted">×${num(l.ordered ?? 0)}</td><td class="num">${money(l.total)}</td></tr>`).join('')}</tbody></table>`
      + (items.length > shown.length ? `<div class="muted">+${num(items.length - shown.length)} more — open the order for all lines</div>` : '');
  }
  function foBlock(o, st) {
    const fos = o.fulfillmentOrders;
    if (!fos.length) return `<h4>Fulfillment</h4><div class="muted">${st < 0 ? 'Cancelled before fulfillment.' : st < 2 ? 'Not released to fulfillment yet.' : 'No fulfillment orders.'}</div>`;
    const ship = (s) => { const track = s.TrackingNumber ? (/^https:\/\//.test(s.TrackingUrl || '') ? `<a href="${esc(s.TrackingUrl)}" target="_blank" rel="noopener">${esc(s.TrackingNumber)} ↗</a>` : esc(s.TrackingNumber)) : '';
      const when = s.ActualDeliveryDate ? `delivered ${shortDate(s.ActualDeliveryDate)}` : s.ExpectedDeliveryDate ? `due ${shortDate(s.ExpectedDeliveryDate)}` : '';
      return `<div class="shp">↳ ${svcLink('Shipment', s.Id, s.ShipmentNumber || 'Shipment')} ${pill(s.Status)} <span class="muted">${[esc(s.Provider || ''), track, when].filter(Boolean).join(' · ')}</span></div>`; };
    return `<h4>Fulfillment · ${num(fos.length)}</h4>${fos.map((f) => {
    // An open FO that hasn't changed in two days is probably stuck; LastModifiedDate is the best proxy for time in status.
    const fs = stepOf(f.Status), idle = f.LastModifiedDate ? Math.floor((Date.now() - new Date(f.LastModifiedDate)) / 864e5) : 0;
    const stuck = fs !== 3 && fs !== -1 && idle >= 2, dest = [f.FulfilledToCity, f.FulfilledToState].filter(Boolean).join(', ');
    const items = (f.items || []).map((l) => { const q = l.quantity || l.original; return `${esc(l.name || 'Item')}${q ? ` ×${num(q)}` : ''}`; });
    return `<div class="fob" role="button" ${recAttr('FulfillmentOrder', f.Id)}><div class="ohd"><b>${esc(f.FulfillmentOrderNumber || 'FO')}</b>${pill(f.Status)}${stuck ? `<span class="badge warn" title="Last changed ${esc(shortDate(f.LastModifiedDate))}">No update in ${num(idle)}d</span>` : ''}</div>
      <div class="muted">${[esc(f.FulfilledFromLocation?.Name || 'Unassigned'), dest && `→ ${esc(dest)}`].filter(Boolean).join(' ')}${f.DeliveryMethod?.Name ? ` · ${esc(f.DeliveryMethod.Name)}` : ''}</div>
      ${items.length ? `<div class="muted fitems">${items.join(', ')}</div>` : ''}${f.shipments === null ? '' : f.shipments.length ? f.shipments.map(ship).join('') : fs === 3 ? '' : '<div class="shp muted">No shipment yet</div>'}</div>`; }).join('')}`;
  }
  function returnsBlock(c) {
    const r = c.returns; if (!r) return '';
    return `<h3>Returns &amp; refunds</h3><div class="chips" style="margin-bottom:var(--sp-3)"><span class="badge">Refunded ${money(r.refunded)}</span><span class="badge">Credit memos ${money(r.credited)}</span></div>`
      + (r.list.length ? `<table><tbody>${r.list.map((x) => `<tr ${recAttr('ReturnOrder', x.Id)}><td><b>${esc(x.ReturnOrderNumber || 'Return')}</b>${x.OrderSummary?.OrderNumber ? ` <span class="muted">order ${esc(x.OrderSummary.OrderNumber)}</span>` : ''}</td><td>${pill(x.Status)}</td><td class="num">${money(x.GrandTotalAmount)}</td><td class="muted">${shortDate(x.CreatedDate)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">No returns.</div>');
  }
  function chatsBlock(c) {
    if (!c.chats) return '';
    if (!c.chats.length) return '<h3>Conversations</h3><div class="muted">No chat transcripts.</div>';
    // Order_Summary_Id__c is free text holding a 15- or 18-character id, so it's matched on the first 15.
    const orderOf = (v) => v && (c.orders || []).find((o) => o.Id.slice(0, 15) === String(v).slice(0, 15));
    return `<h3>Conversations</h3><table><tbody>${c.chats.map((x) => { const o = orderOf(x.Order_Summary_Id__c), t = chatOpen.get(x.Id); return `<tr><td><button class="acct" data-chat="${esc(x.Id)}" aria-expanded="${!!t}">${t ? '▾' : '▸'} Conversation</button> <span class="muted">${svcLink('LiveChatTranscript', x.Id, x.Name || 'Chat')}</span></td><td>${pill(x.Status)}</td><td class="muted">${esc(x.Owner?.Name || '')}</td>
    <td>${x.CaseId ? `<button class="acct" data-rec="Case:${esc(x.CaseId)}">Case ${esc(x.Case?.CaseNumber || '')} →</button>` : ''}${o ? ` <button class="acct" data-order="${esc(o.Id)}">Order ${esc(o.OrderNumber)} →</button>` : ''}</td><td class="muted">${shortDate(x.StartTime || x.CreatedDate)}</td></tr>${t ? `<tr><td colspan="5">${threadHtml(t)}</td></tr>` : ''}`; }).join('')}</tbody></table>`;
  }
  // Expanded transcripts, by chat id: 'loading', an Error, or the /api/service/chat answer. Kept across re-renders of the 360.
  const chatOpen = new Map();
  function threadHtml(t) {
    if (t === 'loading') return '<div class="thread"><div class="sys">Loading conversation…</div></div>';
    if (t instanceof Error) return `<div class="perr">${esc(t.message)}</div>`;
    if (!t.entries) return '<div class="muted">This org doesn\'t store transcript text.</div>';
    if (!t.entries.length) return '<div class="muted">The transcript is empty.</div>';
    // The customer is whoever speaks under the account's first name; everyone else (bot, agents) sits on the right.
    const a = S.cust?.account || {}, first = String(a.FirstName || String(a.Name || '').split(' ')[0]).toLowerCase();
    return `<div class="thread">${t.entries.map((e) => e.kind === 'system' ? `<div class="sys">${esc(e.text)}</div>`
    : `<div class="msg${first && e.who.toLowerCase().split(' ')[0] === first ? ' cust' : ''}"><span class="who">${esc(e.who)} · ${esc(e.at)}</span>${esc(e.text)}${e.buttons ? `<div class="opts">${e.buttons.map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}</div>`).join('')}</div>`;
  }
  async function toggleChat(id) {
    if (chatOpen.has(id)) { chatOpen.delete(id); return renderCustomer(); }
    chatOpen.set(id, 'loading'); renderCustomer();
    try { const r = DEMO ? demoChat(id, S.cust) : await j(`/api/service/chat/${encodeURIComponent(id)}`); if (chatOpen.has(id)) chatOpen.set(id, r); }
    catch (e) { if (isAuthFailure(e)) return showGate({ error: e.message }); if (chatOpen.has(id)) chatOpen.set(id, e); }
    if (chatOpen.has(id)) renderCustomer();
  }
  $('#c360').onclick = (e) => {
    if (e.target.closest('a')) return;
    const t = e.target.closest('[data-order],[data-chat],[data-acct],[data-cust],[data-rec],[data-clear]'); if (!t) return;
    if (t.dataset.order) openOrder(t.dataset.order);
    else if (t.dataset.chat) toggleChat(t.dataset.chat);
    else if (t.dataset.acct) openAny('Account', t.dataset.acct);
    else if (t.dataset.cust) loadCustomer(t.dataset.cust);
    else if (t.dataset.rec) { const [obj, id] = t.dataset.rec.split(':'); openAny(obj, id); }
    else clearCustomer();
  };

  // Search as you type (250 ms debounce, 2+ characters). Only the newest answer paints. Enter before the debounce fires searches at once and opens the top hit.
  let srchSeq = 0, srchFor = '', hits = [], hitSel = 0, srchTimer = null;
  const srchBox = $('#svcSearch');
  async function searchCustomers(q, { open = false } = {}) {
    const seq = ++srchSeq;
    try {
      const r = DEMO ? demoSearch(q) : await j(`/api/service/search?q=${encodeURIComponent(q)}`);
      if (seq !== srchSeq) return;
      srchFor = q; hits = r; hitSel = 0;
      if (open && hits.length) return pickHit(0);
      showHits();
    } catch (e) {
      if (seq !== srchSeq) return;
      if (isAuthFailure(e)) return showGate({ error: e.message });
      hits = []; $('#svcResults').innerHTML = `<div class="perr">${esc(e.message)}</div>`; $('#svcResults').classList.remove('hide');
    }
  }
  function showHits() {
    const box = $('#svcResults');
    box.innerHTML = hits.length ? hits.map((h, i) => `<button type="button" class="${i === hitSel ? 'on' : ''}" data-hit="${i}" role="option"><b>${esc(h.name || 'Customer')}</b><span class="muted">${esc([h.email, [h.city, h.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</span><span class="right">${esc(h.matched)}</span></button>`).join('') : '<div class="empty">No customers match.</div>';
    box.classList.toggle('hide', document.activeElement !== srchBox);
  }
  function pickHit(i) {
    const h = hits[i]; if (!h) return;
    $('#svcResults').classList.add('hide'); srchBox.blur();
    loadCustomer(h.accountId, { focusOrder: h.orderId || null });
  }
  srchBox.oninput = () => {
    srchSeq++; clearTimeout(srchTimer); const q = srchBox.value.trim();
    if (q.length < 2) { srchFor = ''; hits = []; $('#svcResults').classList.add('hide'); return; }
    srchTimer = setTimeout(() => searchCustomers(q), 250);
  };
  srchBox.onkeydown = (e) => {
    const q = srchBox.value.trim();
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length) { e.preventDefault(); hitSel = (hitSel + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; showHits(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (q === srchFor && hits.length) pickHit(hitSel); else if (q.length >= 2) { clearTimeout(srchTimer); searchCustomers(q, { open: true }); } }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!$('#svcResults').classList.contains('hide')) $('#svcResults').classList.add('hide'); else srchBox.blur(); }
  };
  $('#svcResults').onmousedown = (e) => { const b = e.target.closest('[data-hit]'); if (b) { e.preventDefault(); pickHit(Number(b.dataset.hit)); } };
  srchBox.onblur = () => $('#svcResults').classList.add('hide');
  srchBox.onfocus = () => { if (srchFor && srchFor === srchBox.value.trim()) showHits(); };

  return { renderQueue, openQueueItem, moveQueue, loadCustomer, clearCustomer };
}
