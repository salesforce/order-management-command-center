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
// Edit mode for the edit view. tools/build-artifact.mjs puts it in the page; it never ships in public/.
// Turn on ✎ Edit, click an element, say Change, Move or Remove and add a note; "Copy as prompt" gives text to paste back
// into Claude Code. The page shows only sample data, so labels copied from it are sample data too.
// The pure helpers are on OMC_EDIT for tests; nothing touches the DOM unless `document` exists.
(function () {
  'use strict';
  const LABEL_MAX = 60, PATH_STEPS = 4;
  const HEADER = 'Salesforce Order Management Operations Console edits from the edit view (sample data). Apply them with the build-oms-console skill. Use only the design tokens in app/public/shared/ui/tokens.css, and add or update a test; run the whole suite (node --test "app/test/**/*.test.mjs") before saying it is done.';

  const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const cut = (s) => (s.length > LABEL_MAX ? s.slice(0, LABEL_MAX - 1).trimEnd() + '…' : s);
  const ownText = (n) => squash([...(n?.childNodes || [])].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' '));
  // Text with a space between elements, so "<span>Orders</span><b>268</b>" reads "Orders 268", not "Orders268".
  const textOf = (n) => (n.childNodes ? [...n.childNodes].map((c) => (c.nodeType === 3 ? c.textContent : c.nodeType === 1 ? textOf(c) : '')).join(' ') : n.textContent);

  function labelOf(el) {
    return cut(squash(el.getAttribute('aria-label') || el.getAttribute('title') || textOf(el)));
  }

  // tag.class:nth-of-type(n) steps from just inside the panel down to the element; the nearest PATH_STEPS only.
  // Classes come from getAttribute (an SVG element's className isn't a string); state classes are left out.
  function pathOf(panel, el) {
    const steps = [];
    for (let n = el; n && n !== panel; n = n.parentElement) {
      const cls = (n.getAttribute('class') || '').split(/\s+/).filter((c) => c && !/^(on|hide|sel)$|^omc-edit/.test(c)).slice(0, 2);
      const same = n.parentElement ? [...n.parentElement.children].filter((s) => s.tagName === n.tagName) : [n];
      steps.unshift(n.tagName.toLowerCase() + cls.map((c) => '.' + c).join('') + (same.length > 1 ? `:nth-of-type(${same.indexOf(n) + 1})` : ''));
    }
    return (steps.length > PATH_STEPS ? '… ' : '') + steps.slice(-PATH_STEPS).join(' > ');
  }

  const anchorText = (a) => `${a.view} › ${a.panel}${a.id ? ` [#${a.id}]` : ''}${a.path ? ` › ${a.path}` : ''}${a.label ? ` · "${a.label}"` : ''}`;

  function formatPrompt(picks) {
    const lines = [HEADER];
    picks.forEach((p, i) => {
      const what = p.action === 'move' && p.to ? `${anchorText(p.at)} → ${p.to.where} ${anchorText(p.to.at)}` : anchorText(p.at);
      lines.push(`${i + 1}. ${p.action.toUpperCase()} · ${what}`);
      const note = squash(p.note);
      if (note) lines.push(`   Note: ${note}`);
    });
    return lines.join('\n');
  }

  globalThis.OMC_EDIT = { formatPrompt, anchorText, labelOf, pathOf };
  if (typeof document === 'undefined') return;

  // ---------- in the page ----------
  // Panel containers; the nearest one wins. A null name means "use its h2 title".
  const PANELS = [['.zone', null], ['#kpis', 'KPI tiles'], ['#dTiles', 'Dashboard tiles'], ['#dTabs', 'Dashboard tabs'], ['.dhead', 'Dashboard header'],
    ['.top', 'Header bar'], ['#notice', 'Notice'], ['#dNotice', 'Notice'], ['#agentBtn', 'Agentforce'], ['#agentPanel', 'Agentforce panel'], ['#drawer', 'Order drawer'], ['#modal', 'Data map']];
  const NAMES = { c360: 'Customer view' }; // zones without an h2
  const SEL = PANELS.map(([s]) => s).join(',');
  const $ = (s, root = document) => root.querySelector(s);

  function panelOf(el) {
    const p = el.closest(SEL) || el.closest('[id]') || document.body;
    // A zone has no id of its own, so it borrows its body's (#board, pCarrier); other containers use their own id or none.
    const idEl = p.id ? p : p.matches('.zone') ? $(':scope > .body[id], :scope > .dbody[id]', p) || [...p.querySelectorAll('[id]')].find((n) => !n.closest('h2')) : null;
    const id = idEl?.id || '';
    let title = PANELS.find(([s, name]) => name && p.matches(s))?.[1] || ownText($(':scope > h2', p)) || NAMES[id] || id || p.tagName.toLowerCase();
    if (p.id === 'drawer') { const t = ownText($('#oTabs .on')); if (t) title += ` (${t})`; }
    return { el: p, title, id, idEl };
  }
  // The path starts at the panel's id when the element is inside it; otherwise at the nearest other id inside the panel,
  // named first ("#exTabs > button:nth-of-type(2)"); otherwise at the panel itself. Every path is searchable in the source.
  function pathIn(p, el) {
    let from = null;
    for (let n = el; n && n !== p.el; n = n.parentElement) if (n.id) { from = n; break; }
    if (!from) return pathOf(p.el, el);
    if (from === p.idEl) return pathOf(from, el);
    return `#${from.id}` + (from === el ? '' : ` > ${pathOf(from, el)}`);
  }
  function viewOf() {
    const mode = ownText($('#mode .on')) || 'Operations Console';
    const tab = mode === 'Dashboard' && ownText($('#dTabs .on'));
    return tab ? `Dashboard (${tab})` : mode;
  }
  function anchorOf(el) {
    const p = panelOf(el), self = el === p.el || el === p.idEl;
    return { view: viewOf(), panel: p.title, id: p.id, path: self ? '' : pathIn(p, el), label: self ? '' : labelOf(el) };
  }

  document.head.insertAdjacentHTML('beforeend', `<style>
.omc-edit-ui{position:fixed;left:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-start;gap:8px;font:13px/1.4 var(--font,system-ui);color:var(--ink)}
.omc-edit-btn{border-radius:999px;padding:8px 14px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.3)}
.omc-edit-btn[aria-pressed="true"]{background:var(--signal);color:var(--on-accent);border-color:var(--signal)}
.omc-edit-tray,.omc-edit-pop{background:var(--panel);border:1px solid var(--line2);border-radius:var(--r,12px);padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.35);width:360px;max-width:calc(100vw - 32px);box-sizing:border-box}
.omc-edit-pop{position:fixed;z-index:2147483001}
.omc-edit-tray ol{margin:0 0 8px;padding-left:20px;max-height:220px;overflow:auto}
.omc-edit-tray li{margin:3px 0;word-break:break-word}
.omc-edit-tray li button{margin-left:6px}
.omc-edit-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.omc-edit-pop textarea,.omc-edit-out{width:100%;box-sizing:border-box;margin:8px 0;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 8px;font:12.5px/1.4 var(--font,system-ui)}
.omc-edit-out{font-family:ui-monospace,Menlo,monospace;min-height:120px}
.omc-edit-what,.omc-edit-to,.omc-edit-msg{font-size:12px;color:var(--ink2);margin-bottom:8px;word-break:break-word}
.omc-edit-acts{width:max-content;margin-bottom:4px}
.omc-edit-up{margin:-4px 0 8px}
.omc-edit-to .seg-ctl{display:inline-flex;vertical-align:middle}
.omc-edit-hl,.omc-edit-sel{position:fixed;pointer-events:none;z-index:2147482999;border-radius:4px}
.omc-edit-hl{outline:2px solid var(--signal);background:color-mix(in srgb,var(--signal) 12%,transparent)}
.omc-edit-sel{outline:2px dashed var(--amber)}
.omc-edit-hint{background:var(--signal);color:var(--on-accent);border-radius:999px;padding:6px 12px;font-weight:600}
body.omc-edit-on,body.omc-edit-on *{cursor:crosshair!important}
body.omc-edit-on .omc-edit-ui,body.omc-edit-on .omc-edit-ui *{cursor:auto!important}
body.omc-edit-on .omc-edit-ui button{cursor:pointer!important}
.omc-edit-ui [hidden],.omc-edit-hl[hidden],.omc-edit-sel[hidden]{display:none!important}
</style>`);
  document.body.insertAdjacentHTML('beforeend', `<div class="omc-edit-hl" hidden></div><div class="omc-edit-sel" hidden></div>
<div class="omc-edit-ui">
  <div class="omc-edit-pop" role="dialog" aria-label="Edit request" hidden>
    <div class="omc-edit-what"></div>
    <button type="button" class="linkbtn omc-edit-up" data-e="up" title="Select the part around this one; each click goes one level up, to the whole panel">↑ Wider</button>
    <div class="seg-ctl omc-edit-acts" role="group" aria-label="Request"><button type="button" data-act="change">Change</button><button type="button" data-act="move">Move</button><button type="button" data-act="remove">Remove</button></div>
    <div class="omc-edit-to" hidden>Goes <span class="seg-ctl"><button type="button" data-where="before">before</button><button type="button" data-where="after">after</button></span> <span class="omc-edit-tolabel"></span> <button type="button" class="linkbtn" data-e="toup" title="Use the part around it, up to the whole panel">↑ Wider</button> <button type="button" class="linkbtn" data-e="retarget">Pick another place</button></div>
    <textarea rows="3" placeholder="What should change? (optional)" aria-label="Note"></textarea>
    <div class="omc-edit-row"><button type="button" class="primary" data-e="add">Add</button><button type="button" class="chip" data-e="cancel">Cancel</button></div>
  </div>
  <div class="omc-edit-tray" hidden>
    <ol></ol>
    <div class="omc-edit-msg" role="status" hidden></div>
    <textarea class="omc-edit-out" readonly aria-label="Prompt to copy" hidden></textarea>
    <div class="omc-edit-row"><button type="button" class="primary" data-e="copy">Copy as prompt</button><button type="button" class="chip" data-e="clear">Clear</button></div>
  </div>
  <div class="omc-edit-hint" role="status" hidden></div>
  <button type="button" class="omc-edit-btn" aria-pressed="false" title="Pick things to change, move or remove">✎ Edit</button>
</div>`);

  const ui = $('.omc-edit-ui'), hl = $('.omc-edit-hl'), sel = $('.omc-edit-sel'), pop = $('.omc-edit-pop', ui), tray = $('.omc-edit-tray', ui);
  const hint = $('.omc-edit-hint', ui), btn = $('.omc-edit-btn', ui), note = $('textarea', pop), out = $('.omc-edit-out', ui), msg = $('.omc-edit-msg', ui);
  const IDLE = 'Click anything (or Tab to it and press Enter) to change, move or remove it';
  const picks = [];
  let on = false, stage = 'idle', cur = null; // stage: idle → form → (target → form) → idle

  const box = (node, target) => {
    if (!target) { node.hidden = true; return; }
    const r = target.getBoundingClientRect();
    Object.assign(node.style, { left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
    node.hidden = false;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inUi = (t) => t instanceof Element && !!t.closest('.omc-edit-ui');
  const isPanel = (el) => el === panelOf(el).el; // ↑ Wider stops here

  function renderTray() {
    btn.textContent = picks.length ? `✎ Edit · ${picks.length}` : '✎ Edit';
    tray.hidden = !on || !picks.length; // with Edit off, only the button (and its count) stays over the console
    out.hidden = msg.hidden = true; // a prompt shown earlier no longer matches the picks
    $('ol', tray).innerHTML = picks.map((p, i) => `<li><b>${p.action.toUpperCase()}</b> ${esc(p.at.panel)}${p.to ? ` → ${p.to.where} ${esc(p.to.at.panel)}` : ''}${squash(p.note) ? ` · ${esc(squash(p.note))}` : ''}<button type="button" class="linkbtn" data-del="${i}" aria-label="Remove pick ${i + 1}">×</button></li>`).join('');
  }
  function renderPop() {
    $('.omc-edit-what', pop).textContent = anchorText(cur.at);
    pop.querySelectorAll('[data-act]').forEach((b) => { b.classList.toggle('on', b.dataset.act === cur.action); b.setAttribute('aria-pressed', String(b.dataset.act === cur.action)); });
    $('.omc-edit-to', pop).hidden = cur.action !== 'move' || !cur.to;
    if (cur.to) {
      pop.querySelectorAll('[data-where]').forEach((b) => { b.classList.toggle('on', b.dataset.where === cur.to.where); b.setAttribute('aria-pressed', String(b.dataset.where === cur.to.where)); });
      $('.omc-edit-tolabel', pop).textContent = anchorText(cur.to.at);
    }
    $('[data-e="add"]', pop).disabled = cur.action === 'move' && !cur.to;
    $('[data-e="up"]', pop).disabled = isPanel(cur.el);
    $('[data-e="toup"]', pop).disabled = !cur.to || isPanel(cur.to.el);
    pop.hidden = false;
    // After a re-render (the Dashboard redraws on resize) the picked element is gone; the anchor was taken at pick time.
    if (!cur.el.isConnected) { box(sel, null); return; }
    const r = cur.el.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
    pop.style.top = `${r.bottom + 8 + h < innerHeight ? r.bottom + 8 : Math.max(8, r.top - h - 8)}px`;
    box(sel, cur.el);
  }
  function setStage(s, text) {
    stage = s;
    hint.hidden = !text;
    hint.textContent = text || '';
    if (s === 'idle') { cur = null; pop.hidden = true; box(sel, null); }
    if (s === 'target') pop.hidden = true;
  }
  function setOn(v) {
    on = v;
    btn.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('omc-edit-on', on);
    renderTray();
    if (on) setStage('idle', IDLE);
    else { setStage('idle'); box(hl, null); }
  }

  function pick(target) {
    if (stage === 'idle') {
      cur = { el: target, at: anchorOf(target), action: 'change', note: '' };
      note.value = '';
      setStage('form');
      renderPop();
      note.focus();
    } else if (stage === 'target') {
      cur.to = { where: cur.to?.where || 'before', at: anchorOf(target), el: target };
      setStage('form');
      renderPop();
    }
  }

  // Edit mode catches the pointer before the console does, so clicks pick instead of opening orders or dragging the map.
  const swallow = (e) => { if (on && !inUi(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); } };
  for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'auxclick']) window.addEventListener(t, swallow, true);
  window.addEventListener('click', (e) => {
    if (!on || inUi(e.target)) return;
    swallow(e);
    if (e.target instanceof Element) pick(e.target);
  }, true);
  window.addEventListener('mousemove', (e) => {
    if (!on || stage === 'form' || inUi(e.target)) { box(hl, null); return; }
    box(hl, e.target instanceof Element ? e.target : null);
  }, true);
  // The keyboard picks too: what has focus is highlighted, and Enter or Space picks it instead of pressing it.
  window.addEventListener('focusin', (e) => { if (on && stage !== 'form' && !inUi(e.target) && e.target instanceof Element) box(hl, e.target); }, true);
  window.addEventListener('keydown', (e) => {
    if (!on || stage === 'form' || inUi(e.target) || !(e.target instanceof Element) || e.target === document.body || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault(); e.stopImmediatePropagation(); box(hl, null); pick(e.target);
  }, true);
  window.addEventListener('scroll', () => { if (cur && stage === 'form') renderPop(); box(hl, null); }, true);
  // Esc during a pick cancels just the pick, so the drawer, the data map or Agentforce stay open.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !on || stage === 'idle') return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (stage === 'target' && cur) { setStage('form'); renderPop(); } else setStage('idle', IDLE);
  }, true);

  btn.addEventListener('click', () => setOn(!on));
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !cur) return;
    if (b.dataset.act) {
      cur.action = b.dataset.act;
      if (cur.action === 'move' && !cur.to) setStage('target', 'Now click where it should go · Esc to go back');
      else renderPop();
    } else if (b.dataset.where) { cur.to.where = b.dataset.where; renderPop(); }
    else if (b.dataset.e === 'up') {
      if (!isPanel(cur.el)) { cur.el = cur.el.parentElement; cur.at = anchorOf(cur.el); renderPop(); }
    } else if (b.dataset.e === 'toup') {
      if (!isPanel(cur.to.el)) { cur.to.el = cur.to.el.parentElement; cur.to.at = anchorOf(cur.to.el); renderPop(); }
    } else if (b.dataset.e === 'retarget') setStage('target', 'Click where it should go · Esc to go back');
    else if (b.dataset.e === 'cancel') setStage('idle', IDLE);
    else if (b.dataset.e === 'add') {
      picks.push({ action: cur.action, at: cur.at, ...(cur.action === 'move' ? { to: { where: cur.to.where, at: cur.to.at } } : {}), note: note.value });
      renderTray();
      setStage('idle', 'Added. Pick another, or Copy as prompt');
    }
  });
  tray.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.del) { picks.splice(Number(b.dataset.del), 1); renderTray(); }
    else if (b.dataset.e === 'clear') { picks.length = 0; renderTray(); }
    else if (b.dataset.e === 'copy') {
      const text = formatPrompt(picks);
      out.value = text;
      try {
        await navigator.clipboard.writeText(text);
        out.hidden = true;
        msg.textContent = 'Copied. Paste it into Claude Code.';
      } catch {
        // Artifact pages are sandboxed, and the clipboard may be blocked: show the text, selected, to copy by hand.
        out.hidden = false;
        out.focus(); out.select();
        msg.textContent = 'Copying is blocked here. The text below is selected: press ⌘C or Ctrl+C.';
      }
      msg.hidden = false;
    }
  });
  out.addEventListener('focus', () => out.select());
})();
