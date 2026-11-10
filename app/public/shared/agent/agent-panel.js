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
// Agentforce panel: the launcher, the chat panel, per-view sessions and the context line.
// It talks only to j('/api/agent/…'), like every other panel; om-agent.js (server or om-browser.js) makes the real calls.
// Pure helpers are exported for tests, and nothing touches `document` until mountAgent() runs.
import { isReadAction } from './om-agent.js';

export const PROMPTS = {
  service: ['Why is this order stuck?', 'Summarise the open cases', 'What should I check next?'],
  console: ['What needs attention right now?', 'Which locations are falling behind?', "Summarise today's exceptions"],
  dashboard: ['Why did this change?', 'Break this down by…', 'Show me examples'],
  limits: ['What is closest to its limit?', 'What is using the most API calls?', 'Will we run out today?'],
  som: ['What can I do for this order?', 'Why is this order stuck?', 'Diagnose the open exceptions'],
};
export const BRIEF = 'Give me a brief on this customer: 3–5 bullets.';
// Who the row says the context is when no one is open. OM Service Console names no view: it's about a person, or no one yet.
const VIEW_LABEL = { service: 'Service Console', console: 'Operations Console', dashboard: 'Dashboard', limits: 'Org Limits' };
// What may go out per view. Service and OM Service Console send record Ids only, plus OM Service Console's screen and open action as
// lowercase words; the others send view state.
// `facts` (what the page shows, minus anything personal) go in a second block; `label` and `who` (the open customer's name)
// are display only and never sent.
const FIELDS = { service: ['Account', 'OrderSummary', 'Case', 'ProcessException'], console: ['range', 'layer', 'location'], dashboard: ['tab', 'period', 'panel', 'object', 'filter'], limits: ['live'],
  som: ['Account', 'OrderSummary', 'FulfillmentOrder', 'ReturnOrder', 'Case', 'ProcessException', 'screen', 'action'] };
const ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const TOKEN_KEYS = new Set(['screen', 'action']), TOKEN = /^[a-z][a-z0-9-]{0,40}$/;
const idsOnly = (view) => view === 'service' || view === 'som';
// Catches emails, phone numbers and street addresses; it can't recognise a name, so what may be shown is decided by the AGENT flag on panel() in index.html.
const PII = [/@/, /^[+\d\s().-]*$/, /\b\d+\s+\w+(\s+\w+)?\s+(st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|way|ct|court|pl|place)\b/i];
const looksPersonal = (v) => PII[0].test(v) || (PII[1].test(v) && (v.match(/\d/g) || []).length >= 7) || PII[2].test(v);
// `;` `]` `[` `=` and line breaks would let a value end the context line or forge a key, so they become spaces.
const clean = (v) => String(v).replace(/[;[\]=\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

function values(view, key, v) {
  const list = (Array.isArray(v) ? v : [v]).filter((x) => x != null && x !== '').map(clean).filter(Boolean);
  return list.filter((x) => (TOKEN_KEYS.has(key) && view === 'som' ? TOKEN.test(x) : idsOnly(view) ? ID.test(x) : !looksPersonal(x)));
}
function entries(ctx) {
  const keys = FIELDS[ctx?.view]; if (!keys) return null;
  return keys.map((k) => [k, values(ctx.view, k, ctx.fields?.[k])]).filter(([, vs]) => vs.length);
}

// Facts are longer than field values but get the same treatment: no brackets or line breaks, `;` stays the separator.
const cleanFact = (v) => String(v).replace(/[[\]\r\n]+/g, ' ').replace(/;/g, ',').replace(/\s+/g, ' ').trim().slice(0, 160);
export const MAX_FACTS = 15;
// OM Service Console sends everything on screen (an order's lines, its fulfillment and return orders, a record's lists, a new order's
// lines), so its facts fill a budget of characters instead of a count: a question and its context go out as one message of
// at most MESSAGE_MAX (the limit om-agent.js agentMessage() checks), and service/agent.js packs what's open first and names
// by Id what doesn't fit.
export const MESSAGE_MAX = 4000;
export const OM_BUDGET = 3200;
export function contextFacts(ctx) {
  const all = (Array.isArray(ctx?.facts) ? ctx.facts : []).filter((x) => x != null && x !== '').map(cleanFact).filter((x) => x && !looksPersonal(x));
  if (ctx?.view !== 'som') return all.slice(0, MAX_FACTS);
  const out = [];
  let used = 0;
  for (const f of all) {
    const add = f.length + (out.length ? 2 : 0); // joined with '; '
    if (used + add > OM_BUDGET) break;
    out.push(f); used += add;
  }
  return out;
}

export function contextLine(ctx) {
  const e = entries(ctx); if (!e) return '';
  const facts = contextFacts(ctx);
  return `[Context: ${[`view=${ctx.view}`, ...e.map(([k, vs]) => `${k}=${vs.join(',')}`)].join('; ')}]${facts.length ? `\n[On screen: ${facts.join('; ')}]` : ''}`;
}

const NOUN = { Account: 'Account', OrderSummary: 'Order summary', Case: ['case', 'cases'], ProcessException: ['exception', 'exceptions'],
  FulfillmentOrder: ['fulfillment order', 'fulfillment orders'], ReturnOrder: ['return order', 'return orders'] };
// Who the context is (the open customer, else the view), then what's on screen (the row shows it boldest), then its details.
// A page's label uses ` · ` between them.
const oneLine = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function contextParts(ctx) {
  const e = entries(ctx); if (!e) return null;
  const parts = ctx.label ? oneLine(ctx.label, 200).split(' · ').filter(Boolean)
    : e.map(([k, vs]) => Array.isArray(NOUN[k]) ? `${vs.length} ${NOUN[k][vs.length === 1 ? 0 : 1]}` : `${NOUN[k] || k} ${vs.join(', ')}`);
  return { who: oneLine(ctx.who, 80) || VIEW_LABEL[ctx.view] || '', parts };
}
export function contextLabel(ctx) {
  const p = contextParts(ctx);
  return p ? [p.who, ...p.parts].filter(Boolean).join(' · ') : '';
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A record link the agent writes: [label](ObjectApiName/Id), or a Lightning record address (…/lightning/r/Object/Id/view).
// Anything else in a link's parentheses is no record: its label shows as text and the address is dropped.
const LINK = /\[([^\]\n]{1,120})\]\(([^)\s]{1,300})\)/g;
const LIGHTNING = /^(?:https:\/\/[^/]+)?\/lightning\/r\/([A-Za-z][A-Za-z0-9_]{0,79})\/([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\/view$/;
const OBJ_ID = /^(?:record:)?([A-Za-z][A-Za-z0-9_]{0,79})\/([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)$/;
export function recordRef(target) {
  const m = String(target).match(LIGHTNING) || String(target).match(OBJ_ID);
  return m ? { obj: m[1], id: m[2] } : null;
}
// Agent text is escaped first; then only paragraphs, `-` bullets, **bold** and record links become markup. A record link is
// a button (data-agent-rec) only when `canOpen(obj)` says the page can open that object; other links show their label.
export function renderText(s, { canOpen = () => false } = {}) {
  const inline = (t) => {
    const links = [];
    // Links become placeholders first (NUL can't come from the agent: it's stripped), so **bold** can wrap them.
    const raw = String(t).replace(/\0/g, '').replace(LINK, (m, label, target) => {
      const r = recordRef(target), name = esc(label.trim());
      links.push(r && canOpen(r.obj) ? `<button type="button" class="agent-rec" data-agent-rec="${esc(r.obj)}:${esc(r.id)}">${name}</button>` : name);
      return `\0${links.length - 1}\0`;
    });
    return esc(raw).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\0(\d+)\0/g, (m, i) => links[i]);
  };
  return String(s ?? '').trim().split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length && lines.every((l) => /^[-*•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    return lines.length ? `<p>${lines.map(inline).join('<br>')}</p>` : '';
  }).join('');
}

// The auto-brief runs once per thing per page session. A page says what it's about (ctx.brief: { key, text }, null while
// that's still loading); without one it's the customer.
export const briefOf = (c) => (c?.brief !== undefined ? c.brief : c?.customer ? { key: c.customer, text: BRIEF } : null);
export function createBriefs() {
  const done = new Set();
  return { take: (id) => { if (!id || done.has(id)) return false; done.add(id); return true; } };
}

// One agent session per view, started on the first question and kept for the ones after it. Its questions go out one at a
// time, in the order asked: two out at once (the agent's brief, and a question asked before it's answered), and the Agent API
// answers one of them with empty text. One that's waiting when New chat ends its session goes nowhere.
// A session the server says has ended is restarted and the question resent once. Idle sessions end after idleMs.
export function createSessions({ j, idleMs = 15 * 60 * 1000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const live = new Map(); // view -> { id: Promise<string>, turn: Promise (settles when the last question queued is done), timer, inFlight, ended }
  const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  function ensure(view) {
    let s = live.get(view);
    if (!s) {
      s = { id: post('/api/agent/session').then((r) => r.sessionId), turn: Promise.resolve(), timer: null, inFlight: 0, ended: false };
      s.id.catch(() => { if (live.get(view) === s) live.delete(view); });
      live.set(view, s);
    }
    return s;
  }
  function end(view, opts = {}) {
    const s = live.get(view); if (!s) return;
    live.delete(view); clearTimer(s.timer); s.ended = true;
    s.id.then((id) => j(`/api/agent/session/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts })).catch(() => {});
  }
  async function send(view, text) {
    for (let attempt = 0; ; attempt++) {
      const s = ensure(view);
      // The idle clock stops while a question is out or waiting, so a slow answer can't end its own session.
      clearTimer(s.timer); s.timer = null; s.inFlight++;
      const turn = s.turn.then(async () => {
        const id = await s.id;
        // Its session ended while it waited: New chat drops it, and one that expired under an earlier question sends it again.
        if (live.get(view) !== s) throw Object.assign(new Error('The chat ended.'), { kind: s.ended ? 'ended' : 'expired' });
        return post('/api/agent/message', { sessionId: id, text });
      });
      s.turn = turn.catch(() => {});
      try {
        return await turn;
      } catch (e) {
        if (e.kind !== 'expired' || attempt > 0) throw e;
        if (live.get(view) === s) { live.delete(view); clearTimer(s.timer); }
      } finally {
        if (--s.inFlight === 0 && live.get(view) === s) s.timer = setTimer(() => end(view), idleMs);
      }
    }
  }
  return { send, end, endAll: (opts) => [...live.keys()].forEach((v) => end(v, opts)) };
}

const ERRORS = {
  auth: "Agentforce didn't accept your session. Sign in again to use it.",
  missing: "Agentforce isn't set up in this org.",
  unavailable: "Agentforce isn't available right now. Check that the agent is active and that Agentforce is on in Setup.",
  forbidden: "This app isn't connected to the agent. In Setup → Agentforce Agents → OM Console Assistant → Connections, add Salesforce Order Management Operations Console under API.",
  scope: 'Sign in again to turn on Agentforce. The app needs the chatbot_api and sfap_api scopes.',
  credits: 'Agentforce has no credits left in this org. An admin can check Flex Credits in Setup → Digital Wallet.',
};
// The errors an admin fixes in Setup get a link to the steps for turning Agentforce on (the README's "Turn on Agentforce").
export const SETUP_URL = 'https://github.com/salesforce/order-management-operations-console#turn-on-agentforce';
export const SETUP_KINDS = ['missing', 'unavailable', 'forbidden', 'scope', 'credits'];
// Planner bundles prefix action names with the topic (OMC_Order_Lookup_QueryRecords → Query Records), and live replies
// can name them as copilotActionOutput/OMC_Analysis_QueryRecordsWithAggregate.
export const actionLabel = (a) => String(a).replace(/^.*\//, '').replace(/^OMC_(Order_Lookup|Analysis|Service_Desk)_/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

// The panel's own words. A page in another language passes `text` to mountAgent with any of these replaced; what it leaves out
// stays English (the console passes nothing). {name} is filled from the values the panel has (actions, message).
export const TEXT = {
  open: 'Agentforce (A)', badge: 'Brief ready', title: 'Agentforce', newChat: 'New chat', close: 'Close', context: 'Context', sentWith: 'Sent with each question', sentWithFacts: 'Sent with each question:',
  placeholder: 'Ask about orders, exceptions or these numbers', placeholderOm: 'Ask, or say what the customer needs', message: 'Message', send: 'Send', thinking: 'Thinking', retry: 'Retry', signIn: 'Sign in',
  hiOm: 'Ask about this customer and their orders, or ask me to take you somewhere or fill in a change. I never submit anything: you check the preview and submit it.',
  guard: 'The agent used an action that may have changed data: {actions}. Check the record in Salesforce.',
  setup: 'Setup steps', noAnswer: '(No answer.)', checkFailed: "Agentforce couldn't be checked: {message}", noReply: "Agentforce didn't answer.", didntWork: "That didn't work.",
  errors: {},
};
const fmt = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? vars[k] : m));

// Inside a frame taller than the screen, the bottom of the page is out of sight until the page around the frame scrolls:
// Order Management's web tab is 1,100 px tall, and a laptop shows about 650 px of it. An IntersectionObserver sees the part
// of the frame that's on screen, even from another origin, so the page's styles can sit the launcher (and anything else pinned to
// the bottom) at that part's bottom: --view-gap is how far above the frame's bottom it is, --view-h how tall it is.
// Outside a frame neither is set, and each page's defaults (0px and 100vh) keep the window's own bottom.
// The frame is watched as a column of thin strips: an observer reports only when how much of a target shows changes, and
// one tall target shows as much in the middle of a scroll as at its start. Each strip reports as it comes into sight or
// leaves it, in tenths: on a 1,100 px frame, within 6 px.
export function followView({ win = window, doc = document, strips = 20 } = {}) {
  if (win.top === win || typeof win.IntersectionObserver !== 'function') return;
  const root = doc.documentElement, seen = new Map();
  const io = new win.IntersectionObserver((entries) => {
    for (const e of entries) seen.set(e.target, e.intersectionRect);
    const on = [...seen.values()].filter((r) => r.height > 0);
    if (!on.length) return; // the frame is out of sight: there's nothing to place
    const top = Math.min(...on.map((r) => r.top)), bottom = Math.max(...on.map((r) => r.bottom));
    root.style.setProperty('--view-gap', `${Math.max(0, Math.round(win.innerHeight - bottom))}px`);
    root.style.setProperty('--view-h', `${Math.round(bottom - top)}px`);
  }, { threshold: Array.from({ length: 11 }, (_, i) => i / 10) });
  for (let i = 0; i < strips; i++) {
    const strip = doc.createElement('div');
    for (const [k, v] of [['position', 'fixed'], ['left', '0'], ['top', `${(i * 100) / strips}%`], ['width', '1px'], ['height', `${100 / strips}%`], ['pointer-events', 'none']]) strip.style.setProperty(k, v);
    strip.setAttribute('aria-hidden', 'true');
    doc.body.append(strip);
    io.observe(strip);
  }
}

// directives (OM Service Console): parse(text) takes the page's instructions out of a reply ({ text, items }, each item with a
// label), and run(item) carries one out on the page, resolving to a note for the person (or null). The panel runs a reply's
// items as it arrives, if the person is still where they asked, and shows each as a button that runs it again.
// followUp(item) (optional) is what to tell the agent once an item that ran on arrival has found something (a lookup), or null.
// records (optional): { canOpen(obj), open(obj, id) }, how the page opens a record the agent links to by name.
// The launcher's and the panel's icon: a plain chat bubble drawn here in the theme's Agentforce colour (currentColor), named
// by the button's title and the panel's label, so it's aria-hidden. It's generic on purpose: the repo is Apache-2.0, which
// would also license any icon in it, so no Salesforce or Agentforce icon ships here. It has no four-point sparkle, the
// common "AI" motif, so it can't read as one of those icons.
export const AGENT_ICON = '<svg class="agent-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5z"/></svg>';

export function mountAgent({ j, getContext, demo = false, demoReply, onSignedOut, root, directives = null, text: words = null, records = null }) {
  const host = root || document.body;
  const T = { ...TEXT, ...words }, errs = { ...ERRORS, ...T.errors };
  const setupLink = (kind) => (SETUP_KINDS.includes(kind) ? ` <a href="${SETUP_URL}" target="_blank" rel="noopener">${esc(T.setup)} ↗</a>` : '');
  const signInButton = (kind) => (kind === 'scope' || kind === 'auth' ? ` <button type="button" class="chip" data-a="signin">${esc(T.signIn)}</button>` : '');
  const kindOf = (text) => SETUP_KINDS.find((k) => errs[k] === text);
  const sessions = createSessions({ j }), briefs = createBriefs();
  const chats = { service: [], console: [], dashboard: [], som: [] }; // per view: { role, text, actions, guardHit, failed, kind, ask, items }
  const pending = { service: 0, console: 0, dashboard: 0, som: 0 };
  let open = false, checked = demo ? Promise.resolve(true) : null, unavailable = null, busy = 0, badge = false;
  let briefWanted = false, briefCustomer = null; // a brief for what's on screen, from when the panel opened until it's asked

  host.insertAdjacentHTML('beforeend', `
    <button class="agent-btn" id="agentBtn" type="button" aria-expanded="false" aria-controls="agentPanel" title="${esc(T.open)}">
      ${AGENT_ICON}<span class="agent-badge hide" aria-label="${esc(T.badge)}"></span></button>
    <section class="agent-panel hide" id="agentPanel" role="dialog" aria-label="${esc(T.title)}">
      <header>${AGENT_ICON}<b>${esc(T.title)}</b>
        <button type="button" class="chip" data-a="new">${esc(T.newChat)}</button><button type="button" class="agent-x" data-a="close" aria-label="${esc(T.close)}">×</button></header>
      <div class="agent-ctx"></div>
      <div class="agent-msgs" aria-live="polite"></div>
      <div class="agent-prompts"></div>
      <form class="agent-in"><textarea rows="2" maxlength="3500" placeholder="${esc(T.placeholder)}" aria-label="${esc(T.message)}"></textarea><button type="submit" class="chip">${esc(T.send)}</button></form>
    </section>`);
  const btn = host.querySelector('#agentBtn'), panel = host.querySelector('#agentPanel');
  followView(); // in a frame taller than the screen (an Order Management tab), stay in sight
  const $ = (s) => panel.querySelector(s), input = $('textarea');

  const ctx = () => getContext() || { view: 'console', fields: {} };
  const view = () => (chats[ctx().view] ? ctx().view : 'console');

  let shown = null; // the view the message list was last painted for
  // The row shows what the page is about; hovering lists the facts that go with each question.
  function showContext(c) {
    const el = $('.agent-ctx'), facts = contextFacts(c), p = contextParts(c);
    const part = (tag, text, cls) => Object.assign(document.createElement(tag), { textContent: text }, cls ? { className: cls } : {});
    const about = part('div', '', 'agent-about');
    about.append(part('span', T.context, 'agent-where'), ...(p?.who ? [part('b', p.who, 'agent-who')] : []));
    el.replaceChildren(...(p ? [about, ...p.parts.map((x, i) => part(i ? 'span' : 'b', x))] : []));
    el.title = facts.length ? `${T.sentWithFacts}\n${facts.join('\n')}` : T.sentWith;
  }
  function paint() {
    const c = ctx(), v = view(); shown = v;
    btn.classList.toggle('off', !!unavailable); btn.title = unavailable || T.open;
    btn.classList.toggle('thinking', busy > 0);
    btn.querySelector('.agent-badge').classList.toggle('hide', !badge);
    showContext(c);
    input.placeholder = v === 'som' ? T.placeholderOm : T.placeholder;
    const list = chats[v];
    $('.agent-msgs').innerHTML = (unavailable ? `<div class="agent-err">${esc(unavailable)}${setupLink(kindOf(unavailable))}</div>` : '')
      + (!list.length && !unavailable ? `<div class="agent-hi">${v === 'som' ? esc(T.hiOm)
        : `Ask about ${v === 'service' ? 'this customer, their orders and exceptions' : v === 'dashboard' ? 'these numbers' : 'anything in the console'}. I can read data, not change it.`}</div>` : '')
      + list.map((m, i) => m.role === 'user'
        ? `<div class="agent-m me${m.failed ? ' failed' : ''}">${esc(m.text)}${m.failed ? `<div class="agent-fail">${esc(m.failed)} <button type="button" class="linkbtn" data-retry="${i}">${esc(T.retry)}</button></div>` : ''}</div>`
        : m.role === 'error'
          ? `<div class="agent-err">${esc(m.text)}${signInButton(m.kind)}${setupLink(m.kind)}</div>`
          : `<div class="agent-m bot">${m.guardHit ? `<div class="agent-guard">${esc(fmt(T.guard, { actions: m.actions.filter((a) => !isReadAction(a)).join(', ') }))}</div>` : ''}${renderText(m.text, { canOpen: (o) => !!records?.canOpen?.(o) })}${m.items?.length ? `<div class="agent-dos">${m.items.map((it, k) => `<div class="agent-do"><button type="button" class="chip" data-do="${i}:${k}"${it.busy ? ' disabled' : ''}>${esc(it.label)}</button>${it.note ? `<span class="agent-note">${esc(it.note)}</span>` : ''}</div>${it.card ? `<div class="agent-card" data-card="${i}:${k}"></div>` : ''}`).join('')}</div>` : ''}${m.actions?.length ? `<div class="agent-acts">${m.actions.map((a) => `<span>${esc(actionLabel(a))}</span>`).join('')}</div>` : ''}</div>`).join('')
      + (pending[v] ? '<div class="agent-m bot typing" aria-label="${esc(T.thinking)}"><i></i><i></i><i></i></div>' : '');
    paintPrompts(c, v);
    mountCards(); // before scrolling, so a step's card is part of what scrolls into view
    const box = $('.agent-msgs'); box.scrollTop = box.scrollHeight;
  }
  // A redraw that isn't a paint (a card's preview coming back, the suggestions changing) keeps the newest message in view,
  // unless the person had scrolled up to read.
  function keepEnd(draw) {
    const box = $('.agent-msgs'), end = box.scrollHeight - box.scrollTop - box.clientHeight < 8;
    draw();
    if (end) box.scrollTop = box.scrollHeight;
  }
  // The suggestions under the chat: the page's own for the screen it's on (ctx.prompts, never sent), else the view's.
  let promptsShown = null;
  function paintPrompts(c = ctx(), v = view()) {
    const list = unavailable ? [] : (Array.isArray(c.prompts) && c.prompts.length ? c.prompts : PROMPTS[v]).slice(0, 4), key = list.join('\n');
    if (key === promptsShown) return;
    promptsShown = key;
    $('.agent-prompts').innerHTML = list.map((p) => `<button type="button" class="chip" data-p="${esc(p)}">${esc(p)}</button>`).join('');
  }
  // A step's card (a lookup's answer, a change to approve) is drawn by the page with its own DOM builder, never as HTML here.
  function mountCards() {
    if (!directives?.mount) return;
    for (const el of panel.querySelectorAll('[data-card]')) {
      const [i, k] = el.dataset.card.split(':').map(Number), it = chats[shown]?.[i]?.items?.[k];
      if (it?.card) directives.mount(it, el);
    }
  }

  function check() {
    // Only a found agent is remembered; a miss is checked again next time, in case it was just deployed.
    return (checked ||= j('/api/agent/info').then((r) => { if (!r?.agent) { checked = null; unavailable = errs.missing; return false; } return true; })
      .catch((e) => { checked = null; unavailable = errs[e.kind] || fmt(T.checkFailed, { message: e.message }); return false; }));
  }

  // quiet: the agent's reply a follow-up goes under (a lookup's result going back to the agent, runAll()); nothing shows on
  // the person's side, and a failure shows as an error under that reply.
  async function ask(text, { retryOf, quiet } = {}) {
    const v = view(), c = ctx(), list = chats[v];
    if (quiet && !list.includes(quiet)) return; // New chat cleared it
    let m = quiet || retryOf;
    if (!m) { m = { role: 'user', text }; list.push(m); }
    // A question asked while the agent is unavailable stays in the list with Retry, rather than vanishing.
    if (!(await check())) { if (!quiet) m.failed = unavailable; return paint(); }
    unavailable = null; if (!quiet) m.failed = null;
    busy++; pending[v]++; paint();
    const line = contextLine(c), full = `${text}\n\n${line}`.slice(0, MESSAGE_MAX);
    try {
      const r = demo ? await new Promise((res) => setTimeout(() => res(demoReply(text, c)), 700)) : await sessions.send(v, full);
      const got = directives ? directives.parse(r?.text || '') : { text: r?.text || '', items: [] };
      const reply = { role: 'agent', text: got.text || (got.items.length ? '' : T.noAnswer), actions: r?.actions || [], guardHit: !!r?.guardHit, items: got.items };
      if (reply.guardHit) console.warn('Agentforce used an action outside the read-only list:', reply.actions);
      list.splice(list.indexOf(m) + 1, 0, reply);
      if (!open) badge = true;
      // Carried out at once only while the person is still where they asked (same view, same records, same screen), so a slow
      // answer can't pull them away; otherwise each step waits as its button.
      if (reply.items.length && view() === v && JSON.stringify(ctx().fields) === JSON.stringify(c.fields)) queueMicrotask(() => runAll(reply.items, quiet ? null : { v, fields: c.fields, reply }));
    } catch (e) {
      // A 401 here means the agent turned the session down; the console's own session is judged by its panels.
      if (errs[e.kind]) { list.splice(list.indexOf(m) + 1, 0, { role: 'error', text: errs[e.kind], kind: e.kind }); if (e.kind === 'missing' || e.kind === 'unavailable' || e.kind === 'credits') unavailable = errs[e.kind]; }
      else if (quiet) list.splice(list.indexOf(m) + 1, 0, { role: 'error', text: e.message || T.noReply });
      else m.failed = e.message || T.noReply;
    } finally { busy--; pending[v]--; paint(); }
  }

  async function run(it) {
    if (!directives || it.busy) return;
    it.busy = true; it.note = null; paint();
    try { it.note = await directives.run(it); } catch (e) { it.note = e?.message || T.didntWork; }
    it.busy = false; paint();
  }
  // A reply's steps, in order, as it arrives. Then what they found goes back to the agent once (directives.followUp(item) is
  // what to ask, or null), while the person is still where they asked, so its answer can use it; that answer's own steps run,
  // and send nothing back.
  async function runAll(items, from = null) {
    for (const it of items) await run(it);
    const q = from && directives?.followUp ? items.map((it) => directives.followUp(it)).find(Boolean) : null;
    if (q && view() === from.v && JSON.stringify(ctx().fields) === JSON.stringify(from.fields)) await ask(q, { quiet: from.reply });
  }

  // The brief is about what's on screen when the panel opens (once it has loaded), or a new customer opened while it's open;
  // a screen one of the agent's steps goes to gets none. It's spent only once the agent is known to be there.
  function maybeBrief() {
    const c = ctx();
    if (!open || !['service', 'som'].includes(c.view)) return;
    if (c.customer && c.customer !== briefCustomer) { briefCustomer = c.customer; briefWanted = true; }
    const b = briefOf(c);
    if (!briefWanted || !b?.key) return;
    briefWanted = false;
    check().then((ok) => { if (ok && open && briefOf(ctx())?.key === b.key && briefs.take(b.key)) ask(b.text); });
  }

  function setOpen(on) {
    if (on && btn.classList.contains('hide')) return; // no active agent in this org: the panel stays closed
    open = on;
    panel.classList.toggle('hide', !on); btn.setAttribute('aria-expanded', String(on));
    if (on) { badge = false; briefWanted = true; paint(); check().then(() => { paint(); maybeBrief(); }); input.focus(); }
    else { paint(); if (panel.contains(document.activeElement)) btn.focus(); }
  }

  btn.onclick = () => setOpen(!open);
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.a === 'close') setOpen(false);
    else if (b.dataset.a === 'new') { const v = view(); sessions.end(v); chats[v] = []; paint(); input.focus(); }
    else if (b.dataset.a === 'signin') onSignedOut?.({});
    else if (b.dataset.p) { if (b.dataset.p.endsWith('…')) { input.value = b.dataset.p.slice(0, -1) + ' '; input.focus(); } else ask(b.dataset.p); }
    else if (b.dataset.do) { const [i, k] = b.dataset.do.split(':').map(Number), it = chats[view()][i]?.items?.[k]; if (it) run(it); }
    else if (b.dataset.agentRec) { const k = b.dataset.agentRec.indexOf(':'), obj = b.dataset.agentRec.slice(0, k), id = b.dataset.agentRec.slice(k + 1); if (records?.canOpen?.(obj) && ID.test(id)) records.open(obj, id); }
    else if (b.dataset.retry) { const m = chats[view()][b.dataset.retry]; if (m) ask(m.text, { retryOf: m }); }
  });
  $('form').onsubmit = (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ''; ask(t); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('form').requestSubmit(); } });
  addEventListener('pagehide', () => { if (!demo) sessions.endAll({ keepalive: true }); });

  paint();
  // The button shows only when the org has the agent with an Active version (/api/agent/info). An org without one (no
  // Agentforce, or the agent not deployed) never sees it. A check that fails for another reason (signed out, a network
  // error) leaves the button, which then says why. `agent-none` on the page hides its own Ask buttons too.
  if (!demo) check().then((ok) => {
    if (!ok && unavailable === errs.missing) { btn.classList.add('hide'); host.classList.add('agent-none'); if (open) setOpen(false); }
    else if (!ok) paint(); // greys the button and puts the reason in its title
  });
  return {
    available: () => !btn.classList.contains('hide'),
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    isOpen: () => open,
    // A question from the page itself (Diagnose on an exception, say), asked as if typed.
    ask: (text) => {
      if (btn.classList.contains('hide')) return;
      if (!open) setOpen(true);
      ask(text);
    },
    // Called on every re-render of the page, so it repaints only the context row unless the view changed.
    contextChanged: () => { if (view() !== shown) paint(); else { const c = ctx(); showContext(c); keepEnd(() => { paintPrompts(c); mountCards(); }); } maybeBrief(); },
  };
}
